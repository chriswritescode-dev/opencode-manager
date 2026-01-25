# OpenCode Manager Alternatives Research

**Date:** January 2026  
**Conclusion:** Keep opencode-manager - no alternatives have voice capabilities

## Summary

We evaluated open-source alternatives to opencode-manager to determine if migration would be beneficial. After reviewing the top projects, we concluded that opencode-manager should be maintained because its voice features (STT, TTS, Talk Mode) are unique and not available in any alternative.

## Alternatives Evaluated

### 1. claude-code-webui (867 stars)
**Repository:** https://github.com/anthropics/claude-code-webui

**Features:**
- Basic web UI for Claude Code
- Session management
- File browsing

**Missing:**
- No voice/STT support
- No TTS support
- No Talk Mode
- No push notifications
- No Cloudflare tunnel integration

### 2. Portal (314 stars)
**Repository:** https://github.com/anthropics/portal

**Features:**
- Mobile-first design
- Uses official @opencode-ai/sdk
- Clean UI

**Missing:**
- No voice/STT support
- No TTS support
- No Talk Mode
- No push notifications
- No tunnel integration

## opencode-manager Unique Features

| Feature | opencode-manager | claude-code-webui | Portal |
|---------|------------------|-------------------|--------|
| Voice STT (Whisper) | ✅ | ❌ | ❌ |
| TTS (Chatterbox/Coqui) | ✅ | ❌ | ❌ |
| Talk Mode | ✅ | ❌ | ❌ |
| Push Notifications | ✅ | ❌ | ❌ |
| Notification Sound | ✅ | ❌ | ❌ |
| Cloudflare Tunnel | ✅ | ❌ | ❌ |
| Multi-repo Management | ✅ | ❌ | ❌ |
| OpenCode Config UI | ✅ | ❌ | ❌ |

## Decision

**Keep opencode-manager** and continue development because:

1. **Voice is the killer feature** - No other project offers voice-to-code capabilities
2. **Mobile coding use case** - Talk Mode enables hands-free coding from mobile devices
3. **Notification system** - Important for long-running tasks when away from screen
4. **Tunnel integration** - Easy remote access without manual setup

## Improvements Made

Based on this research, we identified and implemented improvements:

1. **Project sync from OpenCode API** - Auto-register projects (including sandboxes like vibe.2, vibe.3)
2. **Removed lsof dependency** - Use OpenCode HTTP API for discovery instead
3. **Health monitoring** - Auto-reconnect when OpenCode server restarts

## Future Considerations

If migrating in the future, consider:
- Porting voice features to Portal (smaller codebase, uses official SDK)
- Contributing STT/TTS as plugins to existing projects
- Creating a standalone voice bridge that works with any Claude Code UI
