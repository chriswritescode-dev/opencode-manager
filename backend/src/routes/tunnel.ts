import { Hono } from 'hono'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

interface TunnelMetrics {
  connected: boolean
  url: string | null
  edgeLocation: string | null
  haConnections: number
  totalRequests: number
  requestErrors: number
  responseCodes: Record<string, number>
  registrationLatencyMs: number | null
  metricsPort: number | null
  version: string | null
}

interface EndpointInfo {
  type: 'tunnel' | 'local'
  url: string
  timestamp: string
}

interface EndpointsFile {
  endpoints: EndpointInfo[]
}

async function parseCloudflaredMetrics(metricsPort: number): Promise<Partial<TunnelMetrics>> {
  try {
    const response = await fetch(`http://localhost:${metricsPort}/metrics`, { 
      signal: AbortSignal.timeout(2000) 
    })
    if (!response.ok) return {}
    
    const text = await response.text()
    const metrics: Partial<TunnelMetrics> = {
      responseCodes: {}
    }
    
    for (const line of text.split('\n')) {
      if (line.startsWith('#') || !line.trim()) continue
      
      if (line.startsWith('cloudflared_tunnel_ha_connections ')) {
        metrics.haConnections = parseInt(line.split(' ')[1], 10)
      }
      else if (line.startsWith('cloudflared_tunnel_total_requests ')) {
        metrics.totalRequests = parseInt(line.split(' ')[1], 10)
      }
      else if (line.startsWith('cloudflared_tunnel_request_errors ')) {
        metrics.requestErrors = parseInt(line.split(' ')[1], 10)
      }
      else if (line.startsWith('cloudflared_tunnel_response_by_code{')) {
        const match = line.match(/status_code="(\d+)"}\s+(\d+)/)
        if (match && metrics.responseCodes) {
          metrics.responseCodes[match[1]] = parseInt(match[2], 10)
        }
      }
      else if (line.startsWith('cloudflared_tunnel_server_locations{')) {
        const match = line.match(/edge_location="([^"]+)"/)
        if (match) {
          metrics.edgeLocation = match[1]
        }
      }
      else if (line.startsWith('cloudflared_tunnel_user_hostnames_counts{')) {
        const match = line.match(/userHostname="([^"]+)"/)
        if (match) {
          metrics.url = match[1]
        }
      }
      else if (line.startsWith('cloudflared_rpc_client_latency_secs_sum{')) {
        const match = line.match(/}\s+([\d.]+)/)
        if (match) {
          metrics.registrationLatencyMs = Math.round(parseFloat(match[1]) * 1000)
        }
      }
      else if (line.startsWith('build_info{')) {
        const match = line.match(/version="([^"]+)"/)
        if (match) {
          metrics.version = match[1]
        }
      }
    }
    
    return metrics
  } catch {
    return {}
  }
}

async function findMetricsPort(): Promise<number | null> {
  const defaultPorts = [20241, 20242, 20243, 20244, 20245]
  
  for (const port of defaultPorts) {
    try {
      const response = await fetch(`http://localhost:${port}/metrics`, { 
        signal: AbortSignal.timeout(500) 
      })
      if (response.ok) return port
    } catch {
      continue
    }
  }
  return null
}

function getTunnelUrlFromEndpoints(): string | null {
  const endpointsPath = join(homedir(), '.local', 'run', 'opencode-manager', 'endpoints.json')
  
  if (!existsSync(endpointsPath)) return null
  
  try {
    const data = JSON.parse(readFileSync(endpointsPath, 'utf-8')) as EndpointsFile
    const tunnelEndpoint = data.endpoints?.find(e => e.type === 'tunnel')
    if (tunnelEndpoint?.url) {
      const url = new URL(tunnelEndpoint.url)
      url.username = ''
      url.password = ''
      return url.toString().replace(/\/$/, '')
    }
  } catch {
    return null
  }
  return null
}

const EDGE_LOCATIONS: Record<string, string> = {
  'sjc': 'San Jose, CA',
  'lax': 'Los Angeles, CA',
  'sea': 'Seattle, WA',
  'ord': 'Chicago, IL',
  'iad': 'Ashburn, VA',
  'ewr': 'Newark, NJ',
  'atl': 'Atlanta, GA',
  'dfw': 'Dallas, TX',
  'ams': 'Amsterdam, NL',
  'lhr': 'London, UK',
  'fra': 'Frankfurt, DE',
  'cdg': 'Paris, FR',
  'nrt': 'Tokyo, JP',
  'sin': 'Singapore',
  'syd': 'Sydney, AU',
}

function formatEdgeLocation(code: string | null): string | null {
  if (!code) return null
  const prefix = code.replace(/\d+$/, '')
  return EDGE_LOCATIONS[prefix] || code.toUpperCase()
}

export function createTunnelRoutes() {
  const app = new Hono()

  app.get('/status', async (c) => {
    const metricsPort = await findMetricsPort()
    const endpointUrl = getTunnelUrlFromEndpoints()
    
    if (!metricsPort) {
      return c.json({
        connected: false,
        url: endpointUrl,
        edgeLocation: null,
        edgeLocationFormatted: null,
        haConnections: 0,
        totalRequests: 0,
        requestErrors: 0,
        responseCodes: {},
        registrationLatencyMs: null,
        metricsPort: null,
        version: null,
        message: 'Cloudflare tunnel not running or metrics not available'
      } satisfies TunnelMetrics & { edgeLocationFormatted: string | null, message: string })
    }

    const metrics = await parseCloudflaredMetrics(metricsPort)
    const url = metrics.url || endpointUrl
    
    return c.json({
      connected: (metrics.haConnections ?? 0) > 0,
      url,
      edgeLocation: metrics.edgeLocation || null,
      edgeLocationFormatted: formatEdgeLocation(metrics.edgeLocation || null),
      haConnections: metrics.haConnections ?? 0,
      totalRequests: metrics.totalRequests ?? 0,
      requestErrors: metrics.requestErrors ?? 0,
      responseCodes: metrics.responseCodes ?? {},
      registrationLatencyMs: metrics.registrationLatencyMs ?? null,
      metricsPort,
      version: metrics.version || null
    })
  })

  app.get('/logs', async (c) => {
    const logPath = join(homedir(), '.local', 'run', 'opencode-manager', 'cloudflared.log')
    const lines = parseInt(c.req.query('lines') || '100', 10)
    
    if (!existsSync(logPath)) {
      return c.json({
        exists: false,
        lines: [],
        totalLines: 0,
        message: 'Log file does not exist yet. Tunnel may not have been started.'
      })
    }
    
    try {
      const content = readFileSync(logPath, 'utf-8')
      const allLines = content.split('\n').filter(line => line.trim())
      const totalLines = allLines.length
      const requestedLines = Math.min(Math.max(1, lines), 1000) // Cap at 1000 lines
      const returnedLines = allLines.slice(-requestedLines)
      
      return c.json({
        exists: true,
        lines: returnedLines,
        totalLines,
        requestedLines,
        path: logPath
      })
    } catch (err) {
      return c.json({
        exists: true,
        lines: [],
        totalLines: 0,
        error: err instanceof Error ? err.message : 'Failed to read log file'
      }, 500)
    }
  })

  return app
}
