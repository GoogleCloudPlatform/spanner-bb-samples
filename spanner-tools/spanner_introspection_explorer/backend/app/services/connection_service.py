# Copyright 2026 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

import os
import re
import glob
import time
import duckdb
import logging
from pathlib import Path
from typing import List, Dict, Any, Optional
from datetime import datetime, timezone

from ..models.connection import DatabaseConnection, CreateConnectionRequest, UpdateConnectionRequest, StagingFolderItem
from .store import ResourceStore
from .duckdb_service import DuckDBService, DATABASE_BASE_DIR
from .gcp_service import GcpDiscoveryService

logger = logging.getLogger(__name__)

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
CONNECTIONS_FILE = PROJECT_ROOT / "backend" / "data" / "connections.json" if (PROJECT_ROOT / "backend").exists() else Path("backend/data/connections.json")
STAGING_DIR = PROJECT_ROOT / "staging" if (PROJECT_ROOT / "staging").exists() else Path("staging")
DBS_DIR = Path(DATABASE_BASE_DIR)

def slugify(text: str) -> str:
    """Converts a name into a clean alphanumeric slug."""
    text = text.lower().strip()
    text = re.sub(r'[^\w\s-]', '', text)
    text = re.sub(r'[\s_-]+', '-', text)
    return text.strip('-') or "db"

class ConnectionService:
    def __init__(self, connections_path: Path = CONNECTIONS_FILE):
        self.store = ResourceStore(connections_path)
        DBS_DIR.mkdir(parents=True, exist_ok=True)
        STAGING_DIR.mkdir(parents=True, exist_ok=True)

    def _enrich_connection_stats(self, conn_dict: Dict[str, Any]) -> DatabaseConnection:
        """Inspects DuckDB file on disk to populate live table counts, row counts, and file size."""
        duckdb_path = conn_dict.get("duckdb_path")
        status = conn_dict.get("status", "NEEDS_INGESTION")
        total_tables = 0
        total_rows = 0
        size_mb = 0.0
        error_msg = None

        if duckdb_path and Path(duckdb_path).exists():
            try:
                size_mb = round(Path(duckdb_path).stat().st_size / (1024 * 1024), 2)
                con = duckdb.connect(duckdb_path, read_only=True)
                tables_res = con.execute("SHOW TABLES;").fetchall()
                total_tables = len(tables_res)
                
                rows_accum = 0
                for (tbl,) in tables_res:
                    try:
                        r_count = con.execute(f'SELECT COUNT(*) FROM "{tbl}";').fetchone()[0]
                        rows_accum += r_count
                    except Exception:
                        pass
                con.close()
                total_rows = rows_accum
                status = "READY" if total_tables > 0 else "NEEDS_INGESTION"
            except Exception as e:
                logger.warning(f"Error inspecting duckdb {duckdb_path}: {e}")
                status = "ERROR"
                error_msg = str(e)
        else:
            status = "NEEDS_INGESTION"

        conn_dict["status"] = status
        conn_dict["total_tables"] = total_tables
        conn_dict["total_rows"] = total_rows
        conn_dict["size_mb"] = size_mb
        if error_msg:
            conn_dict["error_message"] = error_msg

        return DatabaseConnection(**conn_dict)

    def list_connections(self) -> List[DatabaseConnection]:
        raw_list = [c for c in self.store.list() if isinstance(c, dict) and "id" in c and not c["id"].startswith("__")]
        connections = [self._enrich_connection_stats(c) for c in raw_list]
        connections.sort(key=lambda x: x.name)
        return connections

    def get_connection(self, connection_id: str) -> Optional[DatabaseConnection]:
        if connection_id.startswith("__"):
            return None
        conn_dict = self.store.get(connection_id)
        if not conn_dict:
            return None
        return self._enrich_connection_stats(conn_dict)

    def create_connection(self, req: CreateConnectionRequest) -> DatabaseConnection:
        conn_id = slugify(req.name)
        
        # If ID was previously dismissed, un-dismiss it
        dismissed = self.store.get("__dismissed_ids", [])
        if conn_id in dismissed or req.name in dismissed:
            dismissed = [d for d in dismissed if d not in [conn_id, req.name]]
            self.store.put("__dismissed_ids", dismissed)

        # Ensure unique ID
        base_id = conn_id
        counter = 1
        while self.store.get(conn_id):
            conn_id = f"{base_id}-{counter}"
            counter += 1

        duckdb_path = str(DBS_DIR / f"{conn_id}.duckdb")
        staging_path = req.staging_path

        if req.type == "local_staging" and not staging_path:
            staging_path = str(STAGING_DIR / conn_id)

        new_conn = {
            "id": conn_id,
            "name": req.name,
            "type": req.type,
            "dialect": req.dialect,
            "project_id": req.project_id,
            "instance_id": req.instance_id,
            "database_id": req.database_id,
            "staging_path": staging_path,
            "duckdb_path": duckdb_path,
            "status": "NEEDS_INGESTION",
            "total_tables": 0,
            "total_rows": 0,
            "size_mb": 0.0,
            "created_at": datetime.now(timezone.utc).isoformat()
        }

        self.store.put(conn_id, new_conn)
        return self._enrich_connection_stats(new_conn)

    def update_connection(self, connection_id: str, req: UpdateConnectionRequest) -> Optional[DatabaseConnection]:
        existing = self.store.get(connection_id)
        if not existing:
            return None

        if req.name is not None:
            existing["name"] = req.name
        if req.dialect is not None:
            existing["dialect"] = req.dialect
        if req.project_id is not None:
            existing["project_id"] = req.project_id
        if req.instance_id is not None:
            existing["instance_id"] = req.instance_id
        if req.database_id is not None:
            existing["database_id"] = req.database_id
        if req.staging_path is not None:
            existing["staging_path"] = req.staging_path

        self.store.put(connection_id, existing)
        return self._enrich_connection_stats(existing)

    def delete_connection(self, connection_id: str, delete_duckdb: bool = True, delete_staging: bool = False) -> bool:
        import shutil
        conn = self.store.get(connection_id)
        if not conn:
            return False

        # Add to dismissed list so bootstrap doesn't resurrect it
        dismissed = self.store.get("__dismissed_ids", [])
        if connection_id not in dismissed:
            dismissed.append(connection_id)
            self.store.put("__dismissed_ids", dismissed)

        if delete_duckdb:
            duckdb_path = conn.get("duckdb_path")
            if duckdb_path and Path(duckdb_path).exists():
                try:
                    Path(duckdb_path).unlink()
                except Exception as e:
                    logger.warning(f"Failed to delete duckdb file {duckdb_path}: {e}")

        if delete_staging:
            staging_raw = conn.get("staging_path") or f"staging/{connection_id}"
            staging_path = Path(staging_raw)
            if not staging_path.is_absolute() and not staging_path.exists() and (PROJECT_ROOT / staging_path).exists():
                staging_path = PROJECT_ROOT / staging_path
            if staging_path and staging_path.exists():
                try:
                    shutil.rmtree(staging_path)
                except Exception as e:
                    logger.warning(f"Failed to delete staging folder {staging_path}: {e}")

        return self.store.delete(connection_id)

    def scan_staging_folders(self) -> List[StagingFolderItem]:
        """
        Scans staging/ directory and returns list of subdirectories with CSV counts and sizes.
        """
        items = []
        if not STAGING_DIR.exists():
            return items

        for p in STAGING_DIR.iterdir():
            if p.is_dir() and not p.name.startswith("."):
                csvs = list(p.glob("*.csv"))
                has_schema = (p / "schema.sql").exists()
                total_bytes = sum(f.stat().st_size for f in csvs)
                total_mb = round(total_bytes / (1024 * 1024), 2)
                try:
                    display_path = str(p.relative_to(PROJECT_ROOT))
                except ValueError:
                    display_path = str(p)
                items.append(StagingFolderItem(
                    name=p.name,
                    path=display_path,
                    csv_count=len(csvs),
                    has_schema=has_schema,
                    total_size_mb=total_mb
                ))

        items.sort(key=lambda x: x.name)
        return items

    def ingest_staging_into_duckdb(self, connection_id: str, log_callback=None) -> Dict[str, Any]:
        """
        Ingests CSV files from the connection's staging directory into its dedicated DuckDB file.
        For GCP Spanner connections, exports the tables via gcloud into staging before compiling.
        """
        conn = self.get_connection(connection_id)
        if not conn:
            raise ValueError(f"Connection '{connection_id}' not found")

        staging_raw = conn.staging_path or f"staging/{conn.id}"
        staging_dir = Path(staging_raw)
        if not staging_dir.is_absolute() and not staging_dir.exists() and (PROJECT_ROOT / staging_dir).exists():
            staging_dir = PROJECT_ROOT / staging_dir
        duckdb_path = Path(conn.duckdb_path)
        duckdb_path.parent.mkdir(parents=True, exist_ok=True)

        if conn.type == "gcp":
            # Automatically pull Spanner tables using GCP discovery service
            if log_callback:
                log_callback(f"📡 Connecting to GCP Spanner: project={conn.project_id}, instance={conn.instance_id}, database={conn.database_id}")
            gcp_service = GcpDiscoveryService()
            gcp_service.export_database_to_staging(
                project_id=conn.project_id or "",
                instance_id=conn.instance_id or "",
                database_id=conn.database_id or "",
                dialect=conn.dialect,
                staging_dir=staging_dir,
                log_callback=log_callback
            )
        elif not staging_dir.exists():
            raise FileNotFoundError(f"Local staging directory '{staging_dir}' does not exist.")

        csv_files = list(staging_dir.glob("*.csv"))
        if not csv_files:
            if conn.type == "gcp":
                raise FileNotFoundError(f"No CSV tables could be retrieved from Spanner database '{conn.database_id}'. Please check Spanner permissions and instance status.")
            else:
                raise FileNotFoundError(f"No CSV files found in '{staging_dir}'")

        if log_callback:
            log_callback(f"📦 Compiling {len(csv_files)} CSV tables into DuckDB storage ({duckdb_path.name})...")

        temp_db = duckdb_path.with_suffix(".tmp")
        if temp_db.exists():
            temp_db.unlink()

        con = duckdb.connect(str(temp_db))
        ingested_tables = []

        try:
            for csv_file in csv_files:
                table_name = csv_file.stem
                if table_name.startswith("export_all_"):
                    table_name = table_name.replace("export_all_", "")
                
                # Ingest CSV with auto-detection
                query = f"""
                CREATE TABLE "{table_name}" AS 
                SELECT * FROM read_csv_auto('{csv_file.as_posix()}', header=True);
                """
                con.execute(query)
                count = con.execute(f'SELECT COUNT(*) FROM "{table_name}";').fetchone()[0]
                ingested_tables.append({"table": table_name, "rows": count})
                if log_callback:
                    log_callback(f"✓ Loaded {table_name}: {count:,} rows")

            con.close()

            # Replace live DuckDB
            if duckdb_path.exists():
                duckdb_path.unlink()
            temp_db.rename(duckdb_path)

            # Update connection metadata
            conn_dict = self.store.get(connection_id) or {}
            conn_dict["last_synced_at"] = datetime.now(timezone.utc).isoformat()
            conn_dict["status"] = "READY"
            self.store.put(connection_id, conn_dict)

            if log_callback:
                total_rows = sum(t["rows"] for t in ingested_tables)
                log_callback(f"🚀 Ingestion complete: {len(ingested_tables)} tables, {total_rows:,} total rows compiled.")

            return {
                "success": True,
                "connection_id": connection_id,
                "tables_ingested": len(ingested_tables),
                "details": ingested_tables
            }
        except Exception as e:
            if temp_db.exists():
                temp_db.unlink()
            raise e
