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

import asyncio
from typing import List, Dict, Any, Optional
from fastapi import APIRouter, Query, HTTPException

from ..models.connection import (
    GcpProjectItem,
    GcpInstanceItem,
    GcpDatabaseItem,
    TestConnectionRequest
)
from ..services.gcp_service import GcpDiscoveryService

router = APIRouter(prefix="/gcp", tags=["GCP Discovery"])
gcp_service = GcpDiscoveryService()

_warmup_task: Optional[asyncio.Task] = None

def set_warmup_task(task: asyncio.Task) -> None:
    global _warmup_task
    _warmup_task = task

def get_warmup_task() -> Optional[asyncio.Task]:
    global _warmup_task
    return _warmup_task

@router.get("/projects", response_model=List[GcpProjectItem])
async def list_projects(refresh: bool = Query(False, description="Force refresh from GCP")):
    """Returns cached list of accessible GCP projects, with on-demand refresh."""
    cache_file = gcp_service.cache_dir / "gcp_projects.json"
    if not refresh:
        if cache_file.exists():
            return await asyncio.to_thread(gcp_service.list_projects, refresh=False)
        task = get_warmup_task()
        if task and not task.done():
            try:
                await asyncio.shield(task)
            except Exception:
                pass
            if cache_file.exists():
                return await asyncio.to_thread(gcp_service.list_projects, refresh=False)

    return await asyncio.to_thread(gcp_service.list_projects, refresh=refresh)

@router.get("/instances", response_model=List[GcpInstanceItem])
async def list_instances(
    project_id: str = Query(..., description="GCP Project ID"),
    refresh: bool = Query(False, description="Force refresh from GCP")
):
    """Returns Spanner instances for a given project with local caching."""
    return await asyncio.to_thread(gcp_service.list_instances, project_id=project_id, refresh=refresh)

@router.get("/databases", response_model=List[GcpDatabaseItem])
async def list_databases(
    project_id: str = Query(..., description="GCP Project ID"),
    instance_id: str = Query(..., description="Spanner Instance ID"),
    refresh: bool = Query(False, description="Force refresh from GCP")
):
    """Returns Spanner databases for an instance with local caching."""
    return await asyncio.to_thread(gcp_service.list_databases, project_id=project_id, instance_id=instance_id, refresh=refresh)

@router.post("/test")
async def test_connection(req: TestConnectionRequest):
    """Tests live Spanner connectivity and credentials."""
    res = await asyncio.to_thread(
        gcp_service.test_connection,
        project_id=req.project_id,
        instance_id=req.instance_id,
        database_id=req.database_id
    )
    if not res.get("success"):
        raise HTTPException(status_code=400, detail=res.get("message"))
    return res
