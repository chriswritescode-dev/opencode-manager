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

1. Open a repository and click **MCP** in the sidebar
2. Click **Add Server**
3. Select **Local**
4. Configure:

![MCP Servers List](../images/mcp-servers-list.png)

```json
{
  "mcp": {
    "servers": {
      "filesystem": {
        "type": "local",
        "command": [
          "npx",
          "-y",
          "@modelcontextprotocol/server-filesystem",
          "/workspace"
        ]
      }
    }
  }
}
```

| Field | Description |
|-------|-------------|
| Name (key under `mcp.servers`) | Unique identifier |
| `command` | Executable and its arguments, as one array |
| `environment` | Environment variables (optional) |

### Remote Servers (HTTP)

Remote servers are accessed over HTTP/SSE:

1. Go to **Settings > MCP Servers**
2. Click **Add Server**
3. Select **Remote**
4. Configure:

```json
{
  "mcp": {
    "servers": {
      "remote-tools": {
        "type": "remote",
        "url": "https://mcp.example.com/sse"
      }
    }
  }
}
```

| Field | Description |
|-------|-------------|
| Name (key under `mcp.servers`) | Unique identifier |
| `url` | Server endpoint |
| `headers` | HTTP headers (optional) |

## Server Templates

Pre-built configurations for common MCP servers, in the OpenCode 2 `mcp.servers` shape the Manager writes:

### Filesystem

Access local files and directories:

```json
{
  "mcp": {
    "servers": {
      "filesystem": {
        "type": "local",
        "command": [
          "npx",
          "-y",
          "@modelcontextprotocol/server-filesystem",
          "/path/to/dir"
        ]
      }
    }
  }
}
```

### GitHub

Interact with GitHub repositories:

```json
{
  "mcp": {
    "servers": {
      "github": {
        "type": "local",
        "command": [
          "npx",
          "-y",
          "@modelcontextprotocol/server-github"
        ],
        "environment": {
          "GITHUB_TOKEN": "your-token-here"
        }
      }
    }
  }
}
```

### PostgreSQL

Query PostgreSQL databases:

```json
{
  "mcp": {
    "servers": {
      "postgres": {
        "type": "local",
        "command": [
          "npx",
          "-y",
          "@modelcontextprotocol/server-postgres"
        ],
        "environment": {
          "DATABASE_URL": "postgres://user:pass@host:5432/db"
        }
      }
    }
  }
}
```

### Brave Search

Web search capabilities:

```json
{
  "mcp": {
    "servers": {
      "brave-search": {
        "type": "local",
        "command": [
          "npx",
          "-y",
          "@modelcontextprotocol/server-brave-search"
        ],
        "environment": {
          "BRAVE_API_KEY": "your-api-key"
        }
      }
    }
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

### Delete Server

Remove a server:

1. Click the **Delete** button
2. Confirm deletion

### Refresh Status

Use the refresh button in **Settings > MCP Servers** to reload the current connection status after changing a server outside the UI or completing OAuth.

## Server Status

Monitor server health:

| Status | Description |
|--------|-------------|
| Connected | Server is active and connected |
| Disabled | Server is configured but disabled |
| Auth Required | Remote server needs OAuth authentication |
| Registration Required | Remote server needs OAuth client registration |
| Failed | Server failed to start or connect |

## Tool Permissions

The MCP server manager adds, toggles, authenticates, and deletes server configurations. Tool access is controlled by the active OpenCode configuration and any custom agent configuration, not by a separate global MCP permission mode in this screen.

## Troubleshooting

### Server Won't Start

1. Check the command is installed: `npx -y @modelcontextprotocol/server-<name>`
2. Verify environment variables are set
3. Check the displayed status error
4. Try running the command manually

### Tools Not Appearing

1. Verify server status is "Connected"
2. Check server provides the expected tools
3. Refresh server status
4. Check AI model supports tool use

### Connection Issues

For remote servers:

1. Verify URL is correct
2. Check network connectivity
3. Verify authentication headers
4. Check server is running and accessible
