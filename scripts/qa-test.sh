#!/usr/bin/env bash
# QA Test Command - Comprehensive testing for OpenCode Manager
# Usage: /qa-test [test-type] [options]
#
# Test types:
#   health     - Quick health check (backend, frontend, database)
#   api        - Full API endpoint testing
#   auth       - Authentication testing
#   tunnel     - Cloudflare tunnel testing
#   docker     - Docker deployment testing
#   e2e        - End-to-end test suite
#   full       - Run all tests
#
# Options:
#   --url URL  - Test URL (default: http://localhost:5001)
#   --auth     - Enable auth testing (requires AUTH_USERNAME/AUTH_PASSWORD)
#   --report   - Generate detailed report
#
# Examples:
#   /qa-test health
#   /qa-test api --url http://localhost:5001
#   /qa-test auth --auth
#   /qa-test full --report

set -e

TEST_TYPE="${1:-health}"
URL="${2:-http://localhost:5001}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "🧪 OpenCode Manager QA Test Suite"
echo "=================================="
echo "Test Type: $TEST_TYPE"
echo "Target URL: $URL"
echo ""

case "$TEST_TYPE" in
  health)
    echo "Running health checks..."
    echo ""
    
    echo "1. Backend Health"
    if curl -sf "$URL/api/health" > /dev/null; then
      echo -e "${GREEN}✅ Backend responding${NC}"
    else
      echo -e "${RED}❌ Backend not responding${NC}"
      exit 1
    fi
    
    echo ""
    echo "2. OpenCode Server"
    if curl -sf "$URL/api/opencode/global/health" > /dev/null; then
      echo -e "${GREEN}✅ OpenCode server healthy${NC}"
    else
      echo -e "${YELLOW}⚠️  OpenCode server not responding${NC}"
    fi
    
    echo ""
    echo "3. Database"
    if [ -f "data/opencode.db" ]; then
      echo -e "${GREEN}✅ Database exists${NC}"
    else
      echo -e "${YELLOW}⚠️  Database not found${NC}"
    fi
    ;;
    
  api)
    echo "Running API endpoint tests..."
    echo ""
    
    echo "Testing /api/health..."
    curl -s "$URL/api/health" | jq '.'
    
    echo ""
    echo "Testing /api/repos..."
    curl -s "$URL/api/repos" | jq 'length'
    
    echo ""
    echo "Testing /api/settings/opencode-configs..."
    curl -s "$URL/api/settings/opencode-configs" | jq '.configs | length'
    ;;
    
  auth)
    echo "Running authentication tests..."
    echo ""
    
    if [ -z "$AUTH_USERNAME" ] || [ -z "$AUTH_PASSWORD" ]; then
      echo -e "${YELLOW}⚠️  AUTH_USERNAME and AUTH_PASSWORD not set${NC}"
      echo "Set them in environment or .env file"
      exit 1
    fi
    
    echo "Testing without credentials..."
    HTTP_CODE=$(curl -s -w "%{http_code}" -o /dev/null "$URL/api/health")
    if [ "$HTTP_CODE" = "401" ]; then
      echo -e "${GREEN}✅ Correctly rejected (401)${NC}"
    else
      echo -e "${RED}❌ Expected 401, got $HTTP_CODE${NC}"
    fi
    
    echo ""
    echo "Testing with credentials..."
    HTTP_CODE=$(curl -s -w "%{http_code}" -o /dev/null -u "$AUTH_USERNAME:$AUTH_PASSWORD" "$URL/api/health")
    if [ "$HTTP_CODE" = "200" ]; then
      echo -e "${GREEN}✅ Correctly authenticated (200)${NC}"
    else
      echo -e "${RED}❌ Expected 200, got $HTTP_CODE${NC}"
    fi
    ;;
    
  tunnel)
    echo "Testing Cloudflare tunnel..."
    echo ""
    
    echo "Starting tunnel..."
    pnpm start > /tmp/tunnel.log 2>&1 &
    TUNNEL_PID=$!
    
    echo "Waiting for tunnel URL..."
    sleep 15
    
    TUNNEL_URL=$(grep -o "https://.*\.trycloudflare\.com" /tmp/tunnel.log | head -1)
    
    if [ -n "$TUNNEL_URL" ]; then
      echo -e "${GREEN}✅ Tunnel URL: $TUNNEL_URL${NC}"
      
      echo ""
      echo "Testing tunnel access..."
      if curl -sf "$TUNNEL_URL/api/health" > /dev/null; then
        echo -e "${GREEN}✅ Tunnel accessible${NC}"
      else
        echo -e "${RED}❌ Tunnel not accessible${NC}"
      fi
    else
      echo -e "${RED}❌ Tunnel URL not generated${NC}"
    fi
    
    # Cleanup
    kill $TUNNEL_PID 2>/dev/null || true
    ;;
    
  docker)
    echo "Testing Docker deployment..."
    echo ""
    
    echo "Checking Docker image..."
    if docker images | grep -q opencode-manager; then
      echo -e "${GREEN}✅ Docker image exists${NC}"
    else
      echo -e "${YELLOW}⚠️  Docker image not found locally${NC}"
      echo "Run: ./scripts/run-local-docker.sh"
    fi
    
    echo ""
    echo "Checking running containers..."
    if docker ps | grep -q opencode-manager; then
      echo -e "${GREEN}✅ Container running${NC}"
      
      echo ""
      echo "Testing container health..."
      if curl -sf http://localhost:5003/api/health > /dev/null; then
        echo -e "${GREEN}✅ Container healthy${NC}"
      else
        echo -e "${RED}❌ Container not healthy${NC}"
      fi
    else
      echo -e "${YELLOW}⚠️  Container not running${NC}"
      echo "Run: ./scripts/run-local-docker.sh"
    fi
    ;;
    
  e2e)
    echo "Running E2E test suite..."
    echo ""
    
    if [ ! -f "scripts/run-e2e-tests.ts" ]; then
      echo -e "${RED}❌ E2E test script not found${NC}"
      exit 1
    fi
    
    bun run scripts/run-e2e-tests.ts --url "$URL"
    ;;
    
  full)
    echo "Running full test suite..."
    echo ""
    
    $0 health "$URL"
    echo ""
    echo "---"
    echo ""
    
    $0 api "$URL"
    echo ""
    echo "---"
    echo ""
    
    if [ -n "$AUTH_USERNAME" ]; then
      $0 auth "$URL"
      echo ""
      echo "---"
      echo ""
    fi
    
    $0 docker "$URL"
    ;;
    
  *)
    echo -e "${RED}❌ Unknown test type: $TEST_TYPE${NC}"
    echo ""
    echo "Available test types:"
    echo "  health  - Quick health check"
    echo "  api     - API endpoint testing"
    echo "  auth    - Authentication testing"
    echo "  tunnel  - Cloudflare tunnel testing"
    echo "  docker  - Docker deployment testing"
    echo "  e2e     - End-to-end test suite"
    echo "  full    - Run all tests"
    exit 1
    ;;
esac

echo ""
echo -e "${GREEN}✅ Tests completed${NC}"
