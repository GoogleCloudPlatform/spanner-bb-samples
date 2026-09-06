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
import json
import csv
import io
import time
import subprocess
import logging
from pathlib import Path
from typing import List, Dict, Any, Optional

from .spanner_queries import GSQL_INTROSPECTION_QUERIES, PG_INTROSPECTION_QUERIES

logger = logging.getLogger(__name__)

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
CACHE_DIR = PROJECT_ROOT / "backend" / "data" / "cache" if (PROJECT_ROOT / "backend").exists() else Path("backend/data/cache")
PROJECTS_CACHE_FILE = CACHE_DIR / "gcp_projects.json"

class GcpDiscoveryService:
    def __init__(self, cache_dir: Path = CACHE_DIR):
        self.cache_dir = cache_dir
        self.cache_dir.mkdir(parents=True, exist_ok=True)

    def _run_command(self, cmd: List[str], timeout: int = 15) -> Optional[Any]:
        """Runs a subprocess command and parses JSON output."""
        try:
            res = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=timeout,
                check=True
            )
            return json.loads(res.stdout) if res.stdout.strip() else []
        except subprocess.CalledProcessError as e:
            logger.warning(f"GCP command failed: {' '.join(cmd)} - Error: {e.stderr}")
            return None
        except Exception as e:
            logger.warning(f"Failed to execute command {' '.join(cmd)}: {e}")
            return None

    def list_projects(self, refresh: bool = False) -> List[Dict[str, Any]]:
        """
        Returns cached list of GCP projects or queries gcloud projects list.
        """
        cache_file = self.cache_dir / "gcp_projects.json"
        
        # 1. Return cache if valid and refresh not requested
        if not refresh and cache_file.exists():
            try:
                with open(cache_file, "r") as f:
                    data = json.load(f)
                    return data.get("projects", [])
            except Exception as e:
                logger.warning(f"Error reading projects cache: {e}")

        # 2. First get active project (super fast, <0.2s)
        active_project = None
        try:
            res = subprocess.run(
                ["gcloud", "config", "get-value", "project"],
                capture_output=True,
                text=True,
                timeout=5
            )
            if res.returncode == 0 and res.stdout.strip():
                active_val = res.stdout.strip()
                if active_val and active_val != "(unset)":
                    active_project = active_val
        except Exception:
            pass

        # 3. Query gcloud projects list for all projects in the org
        cmd = [
            "gcloud", "projects", "list",
            "--format=json(projectId,name,projectNumber)"
        ]
        raw = self._run_command(cmd, timeout=90)
        
        projects = []
        seen_pids = set()

        # Always add active project first if available
        if active_project:
            projects.append({
                "project_id": active_project,
                "name": f"{active_project} (active config)",
                "project_number": ""
            })
            seen_pids.add(active_project)

        if raw and isinstance(raw, list):
            for p in raw:
                pid = p.get("projectId")
                if pid and pid not in seen_pids:
                    seen_pids.add(pid)
                    projects.append({
                        "project_id": pid,
                        "name": p.get("name") or pid,
                        "project_number": str(p.get("projectNumber") or "")
                    })

        # Cache results if we got projects
        if projects:
            try:
                with open(cache_file, "w") as f:
                    json.dump({
                        "cached_at": time.time(),
                        "projects": projects
                    }, f, indent=2)
            except Exception as e:
                logger.warning(f"Failed to write projects cache: {e}")
        elif cache_file.exists():
            # Fallback to existing cache if query returned empty/failed
            try:
                with open(cache_file, "r") as f:
                    return json.load(f).get("projects", [])
            except Exception:
                pass

        return projects

    def list_instances(self, project_id: str, refresh: bool = False) -> List[Dict[str, Any]]:
        """
        Returns Spanner instances for a given GCP project with disk caching.
        """
        if not project_id:
            return []

        clean_project_id = project_id.strip().split("/")[-1]
        cache_file = self.cache_dir / f"instances_{clean_project_id}.json"
        if not refresh and cache_file.exists():
            try:
                with open(cache_file, "r") as f:
                    return json.load(f).get("instances", [])
            except Exception:
                pass

        cmd = [
            "gcloud", "spanner", "instances", "list",
            f"--project={clean_project_id}",
            "--format=json(name,displayName,nodeCount,state)"
        ]
        raw = self._run_command(cmd, timeout=20)
        
        instances = []
        if raw and isinstance(raw, list):
            for inst in raw:
                raw_name = inst.get("name", "")
                inst_id = raw_name.split("/")[-1] if "/" in raw_name else raw_name
                instances.append({
                    "instance_id": inst_id,
                    "display_name": inst.get("displayName") or inst_id,
                    "node_count": inst.get("nodeCount"),
                    "state": inst.get("state")
                })

        instances.sort(key=lambda x: x["instance_id"])
        try:
            with open(cache_file, "w") as f:
                json.dump({"cached_at": time.time(), "instances": instances}, f, indent=2)
        except Exception:
            pass

        return instances

    def list_databases(self, project_id: str, instance_id: str, refresh: bool = False) -> List[Dict[str, Any]]:
        """
        Returns Spanner databases for an instance with disk caching.
        """
        if not project_id or not instance_id:
            return []

        clean_project_id = project_id.strip().split("/")[-1]
        clean_instance_id = instance_id.strip().split("/")[-1]

        cache_file = self.cache_dir / f"databases_{clean_project_id}_{clean_instance_id}.json"
        if not refresh and cache_file.exists():
            try:
                with open(cache_file, "r") as f:
                    return json.load(f).get("databases", [])
            except Exception:
                pass

        cmd = [
            "gcloud", "spanner", "databases", "list",
            f"--instance={clean_instance_id}",
            f"--project={clean_project_id}",
            "--format=json(name,state,databaseDialect)"
        ]
        raw = self._run_command(cmd, timeout=20)
        
        databases = []
        if raw and isinstance(raw, list):
            for db in raw:
                raw_name = db.get("name", "")
                db_id = raw_name.split("/")[-1] if "/" in raw_name else raw_name
                dialect = db.get("databaseDialect", "GOOGLE_STANDARD_SQL")
                databases.append({
                    "database_id": db_id,
                    "state": db.get("state"),
                    "dialect": dialect if dialect in ["GOOGLE_STANDARD_SQL", "POSTGRESQL"] else "GOOGLE_STANDARD_SQL"
                })

        databases.sort(key=lambda x: x["database_id"])
        try:
            with open(cache_file, "w") as f:
                json.dump({"cached_at": time.time(), "databases": databases}, f, indent=2)
        except Exception:
            pass

        return databases

    def test_connection(self, project_id: str, instance_id: str, database_id: str) -> Dict[str, Any]:
        """
        Executes a lightweight test query against the Spanner database.
        """
        clean_project_id = project_id.strip().split("/")[-1]
        clean_instance_id = instance_id.strip().split("/")[-1]
        clean_database_id = database_id.strip().split("/")[-1]

        cmd = [
            "gcloud", "spanner", "databases", "execute-sql", clean_database_id,
            f"--instance={clean_instance_id}",
            f"--project={clean_project_id}",
            "--sql=SELECT 1 AS status",
            "--format=json"
        ]
        try:
            res = subprocess.run(cmd, capture_output=True, text=True, timeout=15)
            if res.returncode == 0:
                return {
                    "success": True,
                    "message": f"Successfully connected to Cloud Spanner database '{database_id}'!"
                }
            else:
                return {
                    "success": False,
                    "message": f"Connection failed: {res.stderr.strip() or res.stdout.strip()}"
                }
        except subprocess.TimeoutExpired:
            return {
                "success": False,
                "message": "Connection timed out after 15 seconds."
            }
        except Exception as e:
            return {
                "success": False,
                "message": f"Error initiating connection test: {str(e)}"
            }

    def export_database_to_staging(
        self,
        project_id: str,
        instance_id: str,
        database_id: str,
        dialect: str,
        staging_dir: Path,
        log_callback=None
    ) -> List[Dict[str, Any]]:
        """
        Executes all introspection queries via gcloud against the Spanner database
        and exports them as CSVs into staging_dir.
        """
        clean_project_id = project_id.strip().split("/")[-1]
        clean_instance_id = instance_id.strip().split("/")[-1]
        clean_database_id = database_id.strip().split("/")[-1]

        staging_dir.mkdir(parents=True, exist_ok=True)
        query_map = PG_INTROSPECTION_QUERIES if dialect == "POSTGRESQL" else GSQL_INTROSPECTION_QUERIES

        results = []
        for table_stem, clean_sql in query_map.items():
            csv_file = staging_dir / f"{table_stem}.csv"
            clean_sql = clean_sql.strip()
            if not clean_sql:
                continue

            try:
                if log_callback:
                    log_callback(f"⏳ Exporting {table_stem} from Cloud Spanner...")

                cmd = [
                    "gcloud", "spanner", "databases", "execute-sql", clean_database_id,
                    f"--instance={clean_instance_id}",
                    f"--project={clean_project_id}",
                    f"--sql={clean_sql}",
                    "--format=json"
                ]
                res = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
                if res.returncode == 0:
                    data = json.loads(res.stdout or "{}")
                    fields = [
                        f.get("name") for f in data.get("metadata", {}).get("rowType", {}).get("fields", [])
                        if f.get("name")
                    ]
                    rows = data.get("rows", [])

                    out_io = io.StringIO()
                    writer = csv.writer(out_io)
                    if fields:
                        writer.writerow(fields)
                        for row in rows:
                            clean_row = []
                            for cell in row:
                                if cell is None or cell == "NaN" or cell == "nan":
                                    clean_row.append("")
                                elif isinstance(cell, (list, dict)):
                                    clean_row.append(json.dumps(cell))
                                elif isinstance(cell, str) and len(cell) == 20 and cell.endswith("Z") and "T" in cell:
                                    # Convert 2026-08-20T09:50:00Z -> 2026-08-20 09:50:00
                                    clean_row.append(cell.replace("T", " ")[:-1])
                                else:
                                    clean_row.append(str(cell))
                            writer.writerow(clean_row)

                    csv_file.write_text(out_io.getvalue())
                    row_count = len(rows)
                    results.append({"table": table_stem, "rows": row_count, "status": "ok"})
                    if log_callback:
                        log_callback(f"✓ Exported {table_stem}: {row_count:,} rows")
                else:
                    err_msg = res.stderr.strip() or res.stdout.strip()
                    results.append({"table": table_stem, "rows": 0, "status": "error", "error": err_msg})
                    if log_callback:
                        log_callback(f"⚠️ Could not export {table_stem}: {err_msg[:120]}")
            except Exception as ex:
                if log_callback:
                    log_callback(f"⚠️ Error exporting {table_stem}: {str(ex)}")

        # Also fetch schema DDL
        try:
            if log_callback:
                log_callback("⏳ Fetching database schema DDL...")
            ddl_cmd = [
                "gcloud", "spanner", "databases", "ddl", "describe", clean_database_id,
                f"--instance={clean_instance_id}",
                f"--project={clean_project_id}"
            ]
            ddl_res = subprocess.run(ddl_cmd, capture_output=True, text=True, timeout=30)
            if ddl_res.returncode == 0 and ddl_res.stdout.strip():
                (staging_dir / "schema.sql").write_text(ddl_res.stdout)
                if log_callback:
                    log_callback("✓ Successfully exported schema.sql DDL")
        except Exception:
            pass

        return results
