#!/bin/bash
set -e

# Configuration
CONTAINER_NAME="opencode-manager"
WORKER_FILE="backend/src/services/pty-worker.cjs"
DEST_PATH="/app/backend/src/services/"

echo "🔍 Checking for local worker file..."
if [ ! -f "$WORKER_FILE" ]; then
    echo "❌ Error: $WORKER_FILE not found in current directory."
    echo "Please run this script from the root of the repository."
    exit 1
fi
echo "✅ Local file found."

echo "🔍 Checking if container '$CONTAINER_NAME' is running..."
if ! docker ps | grep -q "$CONTAINER_NAME"; then
    echo "❌ Error: Container '$CONTAINER_NAME' is not running."
    exit 1
fi
echo "✅ Container is running."

echo "📦 Copying worker file to container..."
docker cp "$WORKER_FILE" "$CONTAINER_NAME:$DEST_PATH"

echo "✅ File copied. Verifying..."
docker exec "$CONTAINER_NAME" ls -l "${DEST_PATH}pty-worker.cjs"

echo "🔄 Restarting backend process (restarting container)..."
docker restart "$CONTAINER_NAME"

echo "🎉 Done! The terminal service should now be operational."
