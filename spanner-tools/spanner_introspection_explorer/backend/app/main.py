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
import asyncio
import logging
from pathlib import Path
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse

from .api import (
    discovery_router,
    data_router,
    agent_router,
    pipeline_router,
    connections_router,
    gcp_router,
)

logger = logging.getLogger(__name__)

async def _warmup_gcp_projects():
    # Skip during automated pytest runs to ensure tests remain instant and isolated
    if os.environ.get("PYTEST_CURRENT_TEST"):
        return
    try:
        from .services.gcp_service import GcpDiscoveryService
        svc = GcpDiscoveryService()
        cache_file = svc.cache_dir / "gcp_projects.json"
        if not cache_file.exists():
            logger.info("⚡ Background warmup: pre-fetching GCP projects cache...")
            await asyncio.to_thread(svc.list_projects, refresh=False)
            logger.info("✅ Background warmup: GCP projects cache ready.")
    except Exception as e:
        logger.warning(f"Background GCP project cache warmup failed: {e}")

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Spawn non-blocking background task on server startup and register it
    task = asyncio.create_task(_warmup_gcp_projects())
    from .api.gcp import set_warmup_task
    set_warmup_task(task)
    yield

def create_app() -> FastAPI:
    app = FastAPI(
        title="Spanner Introspection Explorer BFF",
        description="High-performance BFF for Cloud Spanner Introspection & DBRE AI Analysis",
        version="2.0.0",
        lifespan=lifespan
    )

    # CORS configuration for development
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Mount API routers under /api/v1
    api_prefix = "/api/v1"
    app.include_router(discovery_router, prefix=api_prefix)
    app.include_router(data_router, prefix=api_prefix)
    app.include_router(agent_router, prefix=api_prefix)
    app.include_router(pipeline_router, prefix=api_prefix)
    app.include_router(connections_router, prefix=api_prefix)
    app.include_router(gcp_router, prefix=api_prefix)

    @app.get("/api/health")
    async def health_check():
        return {"status": "ok", "version": "2.0.0"}

    # Static files & SPA mounting
    static_dir = Path(__file__).parent / "static"
    if static_dir.exists():
        app.mount("/assets", StaticFiles(directory=str(static_dir / "assets")), name="assets") if (static_dir / "assets").exists() else None

        @app.get("/{full_path:path}")
        async def serve_spa(request: Request, full_path: str):
            # Don't intercept API routes
            if full_path.startswith("api/"):
                return JSONResponse(status_code=404, content={"detail": "API endpoint not found"})
            
            target_file = static_dir / full_path
            if full_path and target_file.exists() and target_file.is_file():
                return FileResponse(target_file)

            index_file = static_dir / "index.html"
            if index_file.exists():
                return FileResponse(index_file)
            return JSONResponse(
                status_code=200,
                content={"message": "Spanner Introspection Explorer Backend is running. Frontend static build not yet deployed to backend/app/static."}
            )

    return app

app = create_app()
