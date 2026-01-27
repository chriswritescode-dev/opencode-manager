# Text-to-Speech

Listen to AI responses with built-in or external TTS.

## Overview

OpenCode Manager supports two TTS providers:

1. **Built-in Browser** - Uses your browser's Web Speech API
2. **External API** - OpenAI-compatible TTS endpoints

## Built-in Browser TTS

Uses your browser's built-in speech synthesis via Web Speech API.

### Advantages

- No API key required
- Works offline
- No server communication needed
- Free to use

### Limitations

- Voice quality varies by browser/OS
- Limited voice selection
- No audio caching
- Requires browser support

### Browser Support

Works in modern browsers:
- Chrome, Edge, Safari, Firefox

### Setup

1. Go to **Settings > TTS**
2. Enable **TTS**
3. Select **Built-in Browser** provider
4. Choose a voice from available browser voices
5. Adjust speed if desired
6. Click **Test** to verify

### Voice Selection

Available voices depend on your operating system:

- **Chrome** - Google voices and system voices
- **Safari** - macOS voices (Alex, Samantha, etc.)
- **Firefox** - System voices
- **Edge** - Microsoft voices

### Web Speech API Detection

The system automatically detects if your browser supports Web Speech API. If not supported, you'll see a warning and should switch to External API.

## External API TTS

Connect to OpenAI-compatible TTS endpoints for higher quality voices.

### Advantages

- Higher quality voices
- Consistent across devices
- Audio caching on server
- More voice options
- Composite voice support

### Limitations

- Requires API key and endpoint
- Requires network connection
- Server-side processing

### Setup

1. Go to **Settings > TTS**
2. Enable **TTS**
3. Select **External API** provider
4. Enter the **TTS Server URL**:
   - OpenAI: `https://api.openai.com`
   - Kokoro: `https://your-kokoro-server.com:port`
5. Enter your **API Key**
6. Wait for voice/model discovery
7. Choose voice and model
8. Click **Test** to verify

### Compatible Services

Any OpenAI-compatible TTS API works:

- OpenAI TTS
- Kokoro TTS
- Azure OpenAI
- Local TTS servers
- Self-hosted alternatives

## Voice Configuration

### Voice Discovery

The system automatically discovers available voices and models:

1. On first connection with API key, voices/models are fetched
2. Voice list is cached for 1 hour
3. Click **Refresh** button to force re-discovery if voices change

### Composite Voices

Kokoro-style composite voices are supported. Combine multiple voices for unique effects:
- Example: `am_adam+am_echo`
- Example: `af_bella+af_nova`

## Audio Playback

### Playing Responses

To listen to an AI response:

1. Click the **Play** button on a message
2. Audio streams and plays

### Playback Controls

While audio is playing:

- **Stop** - End playback immediately
- Audio stops if you navigate away

## Markdown Sanitization

Before sending text to TTS, markdown is cleaned for better speech:

- Code blocks removed entirely
- Inline code: `code` → code
- Links: [text](url) → text
- Images: ![alt](url) → alt
- Bold/italic/strikethrough markers removed
- Headers: ### Header → Header
- List markers removed
- Tables converted to readable text
- HTML tags removed
- Whitespace cleaned up

This ensures natural, readable speech playback.
