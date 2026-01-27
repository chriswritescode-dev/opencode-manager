# MCP Servers

Configure Model Context Protocol (MCP) servers to extend AI capabilities.

## What is MCP?

MCP (Model Context Protocol) allows AI models to interact with external tools and data sources. Servers provide:

- **Tools** - Functions the AI can call
- **Resources** - Data the AI can access
- **Prompts** - Pre-defined prompt templates

## Adding Servers

### Local Servers (Command-based)

Local servers run as processes on your machine:

1. Go to **Settings > MCP Servers**
2. Click **Add Server**
3. Select **Local**
4. Configure:

```json
{
  "name": "filesystem",
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-filesystem", "/workspace"]
}
```

| Field | Description |
|-------|-------------|
| `name` | Unique identifier |
| `command` | Executable to run |
| `args` | Command arguments |
| `env` | Environment variables (optional) |

### Remote Servers (HTTP)

Remote servers are accessed over HTTP/SSE:

1. Go to **Settings > MCP Servers**
2. Click **Add Server**
3. Select **Remote**
4. Configure:

```json
{
  "name": "remote-tools",
  "url": "https://mcp.example.com/sse"
}
```

| Field | Description |
|-------|-------------|
| `name` | Unique identifier |
| `url` | Server SSE endpoint |
| `headers` | HTTP headers (optional) |

## Server Templates

Pre-built configurations for common MCP servers:

### Filesystem

Access local files and directories:

```json
{
  "name": "filesystem",
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/dir"]
}
```

### GitHub

Interact with GitHub repositories:

```json
{
  "name": "github",
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-github"],
  "env": {
    "GITHUB_TOKEN": "your-token-here"
  }
}
```

### PostgreSQL

Query PostgreSQL databases:

```json
{
  "name": "postgres",
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-postgres"],
  "env": {
    "DATABASE_URL": "postgres://user:pass@host:5432/db"
  }
}
```

### Brave Search

Web search capabilities:

```json
{
  "name": "brave-search",
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-brave-search"],
  "env": {
    "BRAVE_API_KEY": "your-api-key"
  }
}
```

## Managing Servers

### Enable/Disable

Toggle servers on/off:

1. Go to **Settings > MCP Servers**
2. Find the server
3. Click the toggle switch

Disabled servers won't be started or connected.

### Edit Configuration

Modify server settings:

1. Click the **Edit** button on a server
2. Update configuration
3. Click **Save**
4. Server will restart with new settings

### Delete Server

Remove a server:

1. Click the **Delete** button
2. Confirm deletion

### Restart Server

Force restart a server:

1. Click the **Restart** button
2. Server process is stopped and restarted

Useful after configuration changes or if a server becomes unresponsive.

## Server Status

Monitor server health:

| Status | Description |
|--------|-------------|
| Running | Server is active and connected |
| Starting | Server is launching |
| Stopped | Server is disabled |
| Error | Server failed to start |

Click on a server to see detailed status and logs.

## Tool Permissions

Control which tools AI can access:

### Global Settings

In **Settings > MCP Servers**:

- **Allow All Tools** - AI can use any tool
- **Require Confirmation** - Ask before using tools
- **Deny by Default** - Block tools unless allowed

### Per-Agent Settings

Configure tool access for custom agents:

1. Go to **Settings > Agents**
2. Edit an agent
3. Set **Allowed Tools**
4. Save changes

## Troubleshooting

### Server Won't Start

1. Check the command is installed: `npx -y @modelcontextprotocol/server-<name>`
2. Verify environment variables are set
3. Check server logs for errors
4. Try running the command manually

### Tools Not Appearing

1. Verify server status is "Running"
2. Check server provides the expected tools
3. Restart the server
4. Check AI model supports tool use

### Connection Issues

For remote servers:

1. Verify URL is correct
2. Check network connectivity
3. Verify authentication headers
4. Check server is running and accessible
