# Features Overview

OpenCode Manager provides a comprehensive web interface for managing OpenCode AI agents.

## Core Features

### Repository & Git

- **Multi-Repository Support** - Clone and manage multiple git repos with private repo support via GitHub PAT
- **Git Worktrees** - Work on multiple branches simultaneously
- **Source Control Panel** - View changes, commits, and branches in a unified interface
- **Diff Viewer** - Unified diffs with line numbers and change counts

[Learn more →](git.md)

### File Management

- **Directory Browser** - Navigate files with tree view and search
- **Syntax Highlighting** - Code preview with highlighting for 100+ languages
- **File Operations** - Create, rename, delete, and drag-and-drop upload
- **ZIP Download** - Download repos as ZIP (respects .gitignore)

[Learn more →](files.md)

### Chat & Sessions

- **Real-time Streaming** - Live message streaming with SSE
- **Slash Commands** - Built-in (`/help`, `/new`, `/compact`) and custom commands
- **File Mentions** - Reference files with `@filename` autocomplete
- **Plan/Build Modes** - Toggle between read-only and file-change modes
- **Mermaid Diagrams** - Visual diagram rendering in chat

[Learn more →](chat.md)

### AI Configuration

- **Model Selection** - Browse and filter available AI models
- **Provider Management** - Configure API keys or OAuth for providers
- **OAuth Support** - Secure OAuth login for Anthropic and GitHub Copilot
- **Custom Agents** - Create agents with custom system prompts and tool permissions

[Learn more →](ai-config.md)

### MCP Servers

- **Local Servers** - Add command-based MCP servers
- **Remote Servers** - Connect to HTTP-based MCP servers
- **Templates** - Pre-built configurations for common servers
- **Management** - Enable, disable, and configure servers

[Learn more →](mcp.md)

### Text-to-Speech

- **Browser TTS** - Built-in Web Speech API support
- **External TTS** - Connect to OpenAI-compatible endpoints
- **Audio Caching** - 24-hour cache with 200MB limit
- **Voice Controls** - Configurable voice and speed settings

[Learn more →](tts.md)

### Speech-to-Text

- **Browser STT** - Built-in Web Speech API support
- **External STT** - Connect to OpenAI-compatible Whisper endpoints
- **Voice Input** - Dictate messages with microphone button

[Learn more →](stt.md)

### Mobile & PWA

- **Mobile-First Design** - Responsive UI optimized for mobile
- **PWA Installable** - Add to home screen on any device
- **iOS Optimized** - Proper keyboard handling and swipe navigation

[Learn more →](mobile.md)

### Push Notifications

- **Background Alerts** - Receive notifications when the app is closed
- **Agent Events** - Get alerted for permissions, questions, errors, and completions
- **Multi-Device** - Subscribe multiple devices (phone, tablet, desktop)
- **Customizable** - Control which events trigger notifications

[Learn more →](notifications.md)

