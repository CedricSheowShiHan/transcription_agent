#!/usr/bin/env bash
# Start the app on http://localhost:3000. Run from anywhere: ./run.sh
# Ctrl-C stops it. Keep this terminal open — closing it stops the server.
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -f .env ]; then
  echo "No .env found. Copy .env.example to .env and put your Gemini API key in it:"
  echo "    cp .env.example .env"
  exit 1
fi

if [ ! -d .venv ]; then
  echo "Creating .venv and installing Python dependencies…"
  python3 -m venv .venv
  .venv/bin/pip install -q -r requirements.txt
fi

# The React UI is served from frontend/dist. Rebuild when it is missing, or when any source
# file is newer than the build — otherwise you would silently serve a stale page.
need_build=0
if [ ! -f frontend/dist/index.html ]; then
  need_build=1
elif [ -n "$(find frontend/src frontend/index.html -newer frontend/dist/index.html 2>/dev/null | head -1)" ]; then
  echo "Frontend sources changed since the last build."
  need_build=1
fi

if [ "$need_build" = 1 ]; then
  if ! command -v npm >/dev/null; then
    echo "npm not found — install Node, or the old vanilla UI in static/ is served instead."
  else
    [ -d frontend/node_modules ] || (echo "Installing frontend dependencies…" && cd frontend && npm install)
    echo "Building the frontend…"
    (cd frontend && npm run build)
  fi
fi

echo
echo "  ➜  http://localhost:3000"
echo "     Ctrl-C to stop. Leave this terminal open."
echo
exec .venv/bin/python -m uvicorn app:main --reload --port 3000
