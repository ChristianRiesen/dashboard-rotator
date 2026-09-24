#!/usr/bin/env bash
# Start the dashboard rotator backend server

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR" || exit 1

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    npm install --omit=dev
fi

# Start the server
exec node server.js
