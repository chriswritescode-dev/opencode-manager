#!/bin/bash

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

if command -v docker compose &> /dev/null; then
  DOCKER_COMPOSE="docker compose"
else
  DOCKER_COMPOSE="docker-compose"
fi

NO_PULL=false
SHOW_LOGS=false
MODE="cached"   # cached | tools | full

usage() {
  cat <<EOF
Usage: $0 [--tools | --full] [--no-pull] [--logs]

Rebuild modes (pick one):
  (default)   Cached build. Reuses pnpm install + tool install layers.
              Only changed source (and the frontend build) rerun. ~1-2 min.
  --tools     Cached build, but force a fresh uv/opencode install.
              Keeps the expensive pnpm install cached. ~17 min.
  --full      Full --no-cache rebuild of everything. ~25 min.

Other flags:
  --no-pull   Skip 'git pull'.
  --logs      Follow container logs after starting.
EOF
}

while [[ $# -gt 0 ]]; do
  case $1 in
    --tools)
      MODE="tools"
      shift
      ;;
    --full)
      MODE="full"
      shift
      ;;
    --no-pull)
      NO_PULL=true
      shift
      ;;
    --logs)
      SHOW_LOGS=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      usage
      exit 1
      ;;
  esac
done

if [ "$NO_PULL" = false ]; then
  echo -e "${YELLOW}Updating repository...${NC}"
  git pull || exit 1
fi

echo -e "${YELLOW}Stopping container...${NC}"
$DOCKER_COMPOSE down

case "$MODE" in
  cached)
    echo -e "${YELLOW}Rebuilding image (cached, source-only)...${NC}"
    $DOCKER_COMPOSE build || exit 1
    ;;
  tools)
    echo -e "${YELLOW}Rebuilding image (cached + fresh uv/opencode)...${NC}"
    TOOLS_CACHEBUST="$(date +%s)" $DOCKER_COMPOSE build || exit 1
    ;;
  full)
    echo -e "${YELLOW}Rebuilding image with no cache (full)...${NC}"
    $DOCKER_COMPOSE build --no-cache || exit 1
    ;;
esac

echo -e "${YELLOW}Starting container...${NC}"
$DOCKER_COMPOSE up -d

if [ "$SHOW_LOGS" = true ]; then
  echo -e "${GREEN}Container started. Showing logs...${NC}"
  $DOCKER_COMPOSE logs -f
else
  echo -e "${GREEN}Upgrade complete${NC}"
  $DOCKER_COMPOSE ps
fi
