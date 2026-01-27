# AI Configuration

Configure AI models, providers, and custom agents.

## Model Selection

Browse and select from available AI models:

1. Go to **Settings > Models**
2. Browse models by provider
3. Filter by capability (chat, code, vision)
4. Click a model to set as default

### Model Capabilities

| Capability | Description |
|------------|-------------|
| Chat | General conversation |
| Code | Code generation and analysis |
| Vision | Image understanding |
| Function Calling | Tool use support |

### Changing Models Mid-Session

You can switch models during a chat session:

1. Click the model name in the chat header
2. Select a different model
3. Continue chatting with the new model

Context is preserved when switching models.

## Provider Credentials

Configure API keys or OAuth for AI providers.

### API Key Method

1. Go to **Settings > Provider Credentials**
2. Select a provider (OpenAI, Anthropic, etc.)
3. Enter your API key
4. Click **Save**

### OAuth Method

For providers that support OAuth (Anthropic, GitHub Copilot):

1. Go to **Settings > Provider Credentials**
2. Select a provider with the OAuth badge
3. Click **Add OAuth**
4. Choose authorization method:
   - **Open Authorization Page** - Opens browser for sign-in
   - **Use Authorization Code** - Provides code for manual entry
5. Complete the authorization flow

### Testing Credentials

After adding credentials:

1. Go to **Settings > Models**
2. Models from that provider should appear
3. Select a model and try sending a message

If models don't appear, verify your API key and check for errors.

## Custom Agents

Create specialized AI agents with custom configurations.

### Creating an Agent

1. Go to **Settings > Agents**
2. Click **Create Agent**
3. Configure:
   - **Name** - Display name for the agent
   - **Description** - What this agent does
   - **System Prompt** - Instructions for the AI
   - **Default Model** - Model to use
   - **Allowed Tools** - Which MCP tools it can access

4. Click **Save**

### System Prompt Tips

Write effective system prompts:

```
You are a code review expert specializing in TypeScript and React.

When reviewing code:
1. Check for type safety issues
2. Look for potential bugs
3. Suggest performance improvements
4. Ensure consistent code style

Be concise but thorough. Prioritize issues by severity.
```

### Tool Permissions

Control which MCP tools an agent can use:

- **All Tools** - Access to everything
- **Selected Tools** - Only specific tools
- **No Tools** - Pure conversation, no tool access

This is useful for:

- Security-focused agents that shouldn't modify files
- Research agents that only need read access
- Specialized agents for specific tasks

### Using Custom Agents

1. Start a new session
2. Click the agent selector
3. Choose your custom agent
4. Chat with the specialized agent

## Context Usage

Monitor token usage with the context indicator:

- Progress bar shows current usage
- Updates as conversation grows
- Warning when approaching limits

### Managing Context

When context is running low:

1. Use `/compact` to summarize history
2. Start a new session with `/new`
3. Be more concise in prompts
4. Remove unnecessary file mentions

### Context Limits by Model

Different models have different context limits:

| Model | Context Limit |
|-------|---------------|
| GPT-4 | 8K - 128K tokens |
| Claude 3 | 200K tokens |
| GPT-3.5 | 4K - 16K tokens |

Check your model's documentation for exact limits.
