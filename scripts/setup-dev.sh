#!/bin/bash

set -e

echo "🔍 Checking prerequisites..."

# Check if Node.js/Bun is installed
if command -v bun &> /dev/null; then
  echo "✅ Bun is installed"
  NODE_CMD="bun"
elif command -v node &> /dev/null; then
  echo "✅ Node.js is installed"
  NODE_CMD="node"
else
  echo "❌ Neither Bun nor Node.js is installed. Please install one of them."
  exit 1
fi

# Check if Git is installed
if ! git --version &> /dev/null; then
  echo "❌ Git is not installed. Please install Git and try again."
  exit 1
fi

echo "✅ Git is installed"

# Check if OpenCode TUI is installed
if ! opencode --version &> /dev/null; then
  echo "❌ OpenCode TUI is not installed. Please install it with:"
  echo "   npm install -g @opencode/tui"
  echo "   or"
  echo "   bun add -g @opencode/tui"
  exit 1
fi

echo "✅ OpenCode TUI is installed"

# Create workspace directory if it doesn't exist
WORKSPACE_PATH="./workspace"
if [ ! -d "$WORKSPACE_PATH" ]; then
  echo "📁 Creating workspace directory at $WORKSPACE_PATH..."
  mkdir -p "$WORKSPACE_PATH/repos"
  mkdir -p "$WORKSPACE_PATH/config"
  echo "✅ Workspace directory created"
else
  echo "✅ Workspace directory exists"
fi

# Install dependencies
echo "📦 Installing dependencies..."
if [ "$NODE_CMD" = "bun" ]; then
  bun install
else
  npm install
fi

echo "✅ Dependencies installed"

# Copy environment file if it doesn't exist
if [ ! -f ".env" ]; then
  echo "📝 Creating environment file..."
  cp .env.example .env
  echo "✅ Environment file created from .env.example"
else
  echo "✅ Environment file exists"
fi

echo "✅ Dev environment ready!"
echo ""
echo "🚀 To start development:"
echo "   npm run dev              # Start both backend and frontend"
echo "   npm run dev:backend      # Start backend only"
echo "   npm run dev:frontend     # Start frontend only"
