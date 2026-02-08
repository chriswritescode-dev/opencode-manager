# Speech-to-Text

Dictate messages to AI agents using voice input.

## Overview

OpenCode Manager supports two STT providers:

1. **Built-in Browser** - Uses your browser's Web Speech API
2. **External API** - OpenAI-compatible STT endpoints (Whisper)

## Built-in Browser STT

Uses your browser's built-in speech recognition via the Web Speech API.

### Advantages

- No API key required
- Works without server communication
- Free to use
- Interim results while speaking

### Limitations

- Voice recognition quality varies by browser/OS
- Not supported in all browsers
- Language support depends on browser

### Setup

1. Go to **Settings > Voice**
2. Under **Speech-to-Text**, select **Built-in Browser** provider
3. Optionally configure language
4. Click the microphone button in the chat input to test

## External API STT

Connect to OpenAI-compatible STT endpoints for higher accuracy transcription.

### Advantages

- Higher accuracy transcription
- Consistent across devices
- Supports many languages

### Limitations

- Requires API key and endpoint
- Requires network connection
- Server-side processing

### Setup

1. Go to **Settings > Voice**
2. Under **Speech-to-Text**, select **External API** provider
3. Enter the **STT Server URL**:
    - OpenAI: `https://api.openai.com`
4. Enter your **API Key**
5. Wait for model discovery
6. Choose a model (e.g., `whisper-1`)
7. Optionally set language

### Compatible Services

Any OpenAI-compatible transcription API works:

- OpenAI Whisper
- Azure OpenAI
- Self-hosted Whisper servers
- Local STT servers with OpenAI-compatible API

## Using Voice Input

### Recording

1. Click the **microphone** button in the chat input
2. Speak your message
3. Click the **stop** button when finished
4. Your speech is transcribed into the input field
5. Review and send

### Recording Overlay

While recording, a visual overlay indicates active recording status.

### Aborting

Click the **cancel** button during recording to discard without transcribing.
