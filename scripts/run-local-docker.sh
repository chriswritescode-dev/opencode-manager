#!/bin/bash

set -e

IMAGE="${OPENCODE_IMAGE:-ghcr.io/dzianisv/opencode-manager:latest}"
CONTAINER_NAME="opencode-manager-e2e"
PORT="${OPENCODE_PORT:-5003}"

echo "OpenCode Manager - Local Docker Runner"
echo "======================================="
echo "Image: $IMAGE"
echo "Port: $PORT"
echo ""

cleanup() {
    echo "Stopping container..."
    docker stop "$CONTAINER_NAME" 2>/dev/null || true
    docker rm "$CONTAINER_NAME" 2>/dev/null || true
}

trap cleanup EXIT

if docker ps -a --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
    echo "Removing existing container..."
    docker stop "$CONTAINER_NAME" 2>/dev/null || true
    docker rm "$CONTAINER_NAME" 2>/dev/null || true
fi

echo "Pulling latest image..."
docker pull "$IMAGE"

echo "Starting container..."
docker run -d \
    --name "$CONTAINER_NAME" \
    -p "${PORT}:5003" \
    -e YOLO_MODE=true \
    "$IMAGE"

echo "Waiting for container to be healthy..."
for i in {1..60}; do
    if curl -s "http://localhost:${PORT}/api/health" | grep -q '"status":"healthy"'; then
        echo "Container is healthy!"
        break
    fi
    if [ $i -eq 60 ]; then
        echo "Container failed to become healthy"
        docker logs "$CONTAINER_NAME"
        exit 1
    fi
    sleep 2
done

echo ""
echo "OpenCode Manager is running at http://localhost:${PORT}"
echo ""
echo "To run E2E tests:"
echo "  bun run scripts/test-voice-e2e.ts --url http://localhost:${PORT}"
echo "  bun run scripts/test-talkmode-e2e.ts --url http://localhost:${PORT}"
echo "  bun run scripts/test-talkmode-browser.ts --url http://localhost:${PORT}"
echo ""
echo "Press Ctrl+C to stop..."

docker logs -f "$CONTAINER_NAME"
