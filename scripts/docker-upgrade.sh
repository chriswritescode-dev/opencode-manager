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

while [[ $# -gt 0 ]]; do
  case $1 in
    --no-pull)
      NO_PULL=true
      shift
      ;;
    --logs)
      SHOW_LOGS=true
      shift
      ;;
    *)
      echo "Usage: $0 [--no-pull] [--logs]"
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

echo -e "${YELLOW}Rebuilding image with no cache...${NC}"
$DOCKER_COMPOSE build --no-cache

echo -e "${YELLOW}Starting container...${NC}"
$DOCKER_COMPOSE up -d

if [ "$SHOW_LOGS" = true ]; then
  echo -e "${GREEN}Container started. Showing logs...${NC}"
  $DOCKER_COMPOSE logs -f
else
  echo -e "${GREEN}Upgrade complete${NC}"
  $DOCKER_COMPOSE ps
fi