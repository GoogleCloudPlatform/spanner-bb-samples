#!/usr/bin/env python3

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

"""
Spanner Introspection Explorer - Single-Port Launcher
Serves both the FastAPI BFF REST/SSE API and the compiled React frontend from a single port (8080).
"""

import os
import sys
import subprocess
import argparse
from pathlib import Path

def check_and_build_frontend(static_dir: Path, frontend_dir: Path):
    """Ensures static React assets exist before starting server."""
    index_html = static_dir / "index.html"
    if not index_html.exists():
        print("⚡ Pre-compiled frontend assets not found in backend/app/static/.")
        if (frontend_dir / "package.json").exists():
            print("📦 Building frontend production bundle via Vite...")
            try:
                subprocess.run(["npm", "run", "build"], cwd=str(frontend_dir), check=True)
                print("✅ Frontend build completed successfully.\n")
            except Exception as e:
                print(f"⚠️ Warning: Frontend build failed ({e}). Running in API-only mode.\n")
        else:
            print("⚠️ Warning: Frontend directory not found. Running in API-only mode.\n")

def auto_activate_venv(base_dir: Path):
    """If running in system Python and a local project .venv exists, seamlessly re-exec in .venv."""
    venv_candidates = [
        base_dir / ".venv" / "bin" / "python",
        base_dir / "venv" / "bin" / "python",
        base_dir / ".venv" / "Scripts" / "python.exe",
        base_dir / "venv" / "Scripts" / "python.exe",
    ]
    for venv_py in venv_candidates:
        if venv_py.exists() and sys.executable != str(venv_py):
            os.environ["VIRTUAL_ENV"] = str(venv_py.parent.parent)
            os.environ["PATH"] = str(venv_py.parent) + os.pathsep + os.environ.get("PATH", "")
            os.execv(str(venv_py), [str(venv_py)] + sys.argv)

def main():
    base_dir = Path(__file__).parent.resolve()
    auto_activate_venv(base_dir)

    parser = argparse.ArgumentParser(description="Spanner Introspection Explorer Single-Port Server")
    parser.add_argument("--host", default="0.0.0.0", help="Host address (default: 0.0.0.0)")
    parser.add_argument("--port", type=int, default=8080, help="Port to listen on (default: 8080)")
    parser.add_argument("--reload", action="store_true", default=True, help="Enable auto-reload (default: True)")
    parser.add_argument("--no-reload", action="store_false", dest="reload", help="Disable auto-reload")
    args = parser.parse_args()

    static_dir = base_dir / "backend" / "app" / "static"
    frontend_dir = base_dir / "frontend"

    # Check frontend assets
    check_and_build_frontend(static_dir, frontend_dir)

    print("=" * 70)
    print("🚀 Spanner Introspection Explorer (React 18 + FastAPI BFF)")
    print("=" * 70)
    print(f"📍 Web UI & REST API: http://localhost:{args.port}")
    print(f"📡 API Documentation: http://localhost:{args.port}/docs")
    print(f"📂 DuckDB Database:   {base_dir / 'my_duckdb.db'}")
    print("=" * 70)
    print("Press Ctrl+C to stop the server.\n")

    try:
        import uvicorn
    except ImportError as e:
        print("❌ Error: Missing required dependencies (" + str(e) + ")")
        print("\n👉 Quick Setup (1-time):")
        print("   python3 -m venv .venv")
        print("   source .venv/bin/activate")
        print("   pip install -r requirements.txt")
        print("   python3 run.py\n")
        sys.exit(1)

    uvicorn.run(
        "backend.app.main:app",
        host=args.host,
        port=args.port,
        reload=args.reload,
        reload_dirs=[str(base_dir / "backend" / "app")] if args.reload else None,
    )

if __name__ == "__main__":
    main()
