export interface McpServerTemplate {
  id: string
  name: string
  description: string
  type: 'local' | 'remote'
  command?: string[]
  url?: string
  environment?: Record<string, string>
  docsUrl?: string
  oauth?: boolean | {
    clientId?: string
    clientSecret?: string
    scope?: string
  }
  category?: 'google' | 'database' | 'productivity' | 'development' | 'other'
}

export const MCP_SERVER_TEMPLATES: McpServerTemplate[] = [
  {
    id: 'google-workspace',
    name: 'Google Workspace',
    description: 'Full access to Gmail, Calendar, Drive, Docs, Sheets, and more',
    type: 'local',
    command: ['uvx', 'workspace-mcp', '--tool-tier', 'full'],
    environment: {
      GOOGLE_CLIENT_ID: '',
      GOOGLE_CLIENT_SECRET: '',
    },
    oauth: {
      scope: 'https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/drive',
    },
    docsUrl: 'https://github.com/taylorwilsdon/google_workspace_mcp',
    category: 'google',
  },
  {
    id: 'gmail',
    name: 'Gmail',
    description: 'Read, send, and manage Gmail emails with full attachment support',
    type: 'local',
    command: ['npx', '-y', '@gongrzhe/server-gmail-autoauth-mcp'],
    environment: {
      GMAIL_OAUTH_CLIENT_ID: '',
      GMAIL_OAUTH_CLIENT_SECRET: '',
    },
    oauth: {
      scope: 'https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/gmail.send',
    },
    docsUrl: 'https://github.com/GongRzhe/Gmail-MCP-Server',
    category: 'google',
  },
  {
    id: 'google-calendar',
    name: 'Google Calendar',
    description: 'Manage calendar events, check availability, and schedule meetings',
    type: 'local',
    command: ['npx', '-y', 'mcp-google-calendar'],
    environment: {
      GOOGLE_CLIENT_ID: '',
      GOOGLE_CLIENT_SECRET: '',
    },
    oauth: {
      scope: 'https://www.googleapis.com/auth/calendar',
    },
    docsUrl: 'https://github.com/am2rican5/mcp-google-calendar',
    category: 'google',
  },
  {
    id: 'google-drive',
    name: 'Google Drive',
    description: 'Access and manage files in Google Drive and Sheets',
    type: 'local',
    command: ['npx', '-y', 'mcp-gdrive'],
    environment: {
      GOOGLE_CLIENT_ID: '',
      GOOGLE_CLIENT_SECRET: '',
    },
    oauth: {
      scope: 'https://www.googleapis.com/auth/drive',
    },
    docsUrl: 'https://github.com/isaacphi/mcp-gdrive',
    category: 'google',
  },
  {
    id: 'filesystem',
    name: 'Filesystem',
    description: 'Access and manipulate local files and directories',
    type: 'local',
    command: ['npx', '@modelcontextprotocol/server-filesystem', '/tmp'],
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem',
    category: 'development',
  },
  {
    id: 'git',
    name: 'Git',
    description: 'Interact with Git repositories',
    type: 'local',
    command: ['npx', '@modelcontextprotocol/server-git', '--repository', '.'],
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/git',
    category: 'development',
  },
  {
    id: 'sqlite',
    name: 'SQLite',
    description: 'Query and manage SQLite databases',
    type: 'local',
    command: ['npx', '@modelcontextprotocol/server-sqlite', '--db-path', './data.db'],
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/sqlite',
    category: 'database',
  },
  {
    id: 'postgres',
    name: 'PostgreSQL',
    description: 'Connect to PostgreSQL databases',
    type: 'local',
    command: ['npx', '@modelcontextprotocol/server-postgres'],
    environment: {
      POSTGRES_CONNECTION_STRING: 'postgresql://user:password@localhost:5432/dbname',
    },
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/postgres',
    category: 'database',
  },
  {
    id: 'brave-search',
    name: 'Brave Search',
    description: 'Web search using Brave Search API',
    type: 'local',
    command: ['npx', '@modelcontextprotocol/server-brave-search'],
    environment: {
      BRAVE_API_KEY: 'your-brave-api-key-here',
    },
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/brave-search',
    category: 'productivity',
  },
  {
    id: 'github',
    name: 'GitHub',
    description: 'Interact with GitHub repositories and issues',
    type: 'local',
    command: ['npx', '@modelcontextprotocol/server-github'],
    environment: {
      GITHUB_PERSONAL_ACCESS_TOKEN: 'your-github-token-here',
    },
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/github',
    category: 'development',
  },
  {
    id: 'slack',
    name: 'Slack',
    description: 'Read and send messages to Slack channels',
    type: 'local',
    command: ['npx', '@modelcontextprotocol/server-slack'],
    environment: {
      SLACK_BOT_TOKEN: 'xoxb-your-slack-bot-token',
    },
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/slack',
    category: 'productivity',
  },
  {
    id: 'puppeteer',
    name: 'Puppeteer',
    description: 'Web automation and scraping with Puppeteer',
    type: 'local',
    command: ['npx', '@modelcontextprotocol/server-puppeteer'],
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/puppeteer',
    category: 'development',
  },
  {
    id: 'fetch',
    name: 'Fetch',
    description: 'Make HTTP requests to web APIs',
    type: 'local',
    command: ['npx', '@modelcontextprotocol/server-fetch'],
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/fetch',
    category: 'development',
  },
  {
    id: 'memory',
    name: 'Memory',
    description: 'Persistent memory storage for conversations',
    type: 'local',
    command: ['npx', '@modelcontextprotocol/server-memory'],
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/memory',
    category: 'productivity',
  },
  {
    id: 'custom-local',
    name: 'Custom Local Server',
    description: 'Run a custom MCP server locally',
    type: 'local',
    command: ['node', '/path/to/your/server.js'],
    category: 'other',
  },
  {
    id: 'custom-remote',
    name: 'Custom Remote Server',
    description: 'Connect to a remote MCP server via HTTP',
    type: 'remote',
    url: 'http://localhost:3000/mcp',
    category: 'other',
  },
]

export function getMcpServerTemplate(id: string): McpServerTemplate | undefined {
  return MCP_SERVER_TEMPLATES.find((t) => t.id === id)
}

export function getGoogleMcpTemplates(): McpServerTemplate[] {
  return MCP_SERVER_TEMPLATES.filter((t) => t.category === 'google')
}

export function getMcpTemplatesByCategory(category: McpServerTemplate['category']): McpServerTemplate[] {
  return MCP_SERVER_TEMPLATES.filter((t) => t.category === category)
}