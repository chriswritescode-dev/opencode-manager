export interface McpServerTemplate {
  id: string
  name: string
  description: string
  type: 'local' | 'remote'
  command?: string[]
  url?: string
  environment?: Record<string, string>
  docsUrl?: string
}

export const MCP_SERVER_TEMPLATES: McpServerTemplate[] = [
  {
    id: 'filesystem',
    name: 'Filesystem',
    description: 'Access and manipulate local files and directories',
    type: 'local',
    command: ['npx', '@modelcontextprotocol/server-filesystem', '/tmp'],
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem',
  },
  {
    id: 'git',
    name: 'Git',
    description: 'Interact with Git repositories',
    type: 'local',
    command: ['npx', '@modelcontextprotocol/server-git', '--repository', '.'],
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/git',
  },
  {
    id: 'sqlite',
    name: 'SQLite',
    description: 'Query and manage SQLite databases',
    type: 'local',
    command: ['npx', '@modelcontextprotocol/server-sqlite', '--db-path', './data.db'],
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/sqlite',
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
  },
  {
    id: 'puppeteer',
    name: 'Puppeteer',
    description: 'Web automation and scraping with Puppeteer',
    type: 'local',
    command: ['npx', '@modelcontextprotocol/server-puppeteer'],
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/puppeteer',
  },
  {
    id: 'fetch',
    name: 'Fetch',
    description: 'Make HTTP requests to web APIs',
    type: 'local',
    command: ['npx', '@modelcontextprotocol/server-fetch'],
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/fetch',
  },
  {
    id: 'memory',
    name: 'Memory',
    description: 'Persistent memory storage for conversations',
    type: 'local',
    command: ['npx', '@modelcontextprotocol/server-memory'],
    docsUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/memory',
  },
  {
    id: 'custom-local',
    name: 'Custom Local Server',
    description: 'Run a custom MCP server locally',
    type: 'local',
    command: ['node', '/path/to/your/server.js'],
  },
  {
    id: 'custom-remote',
    name: 'Custom Remote Server',
    description: 'Connect to a remote MCP server via HTTP',
    type: 'remote',
    url: 'http://localhost:3000/mcp',
  },
]

export function getMcpServerTemplate(id: string): McpServerTemplate | undefined {
  return MCP_SERVER_TEMPLATES.find((t) => t.id === id)
}