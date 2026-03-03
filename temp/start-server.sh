#!/usr/bin/env bash
# Start the dashboard rotator backend server

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    npm install --production
fi

# Start the server
exec node server.js
