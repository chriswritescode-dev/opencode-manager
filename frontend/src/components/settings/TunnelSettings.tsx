import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/api/client'
import { Loader2, Globe, Wifi, WifiOff, MapPin, Activity, Clock, ExternalLink, Copy, Check } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useState } from 'react'

interface TunnelStatus {
  connected: boolean
  url: string | null
  edgeLocation: string | null
  edgeLocationFormatted: string | null
  haConnections: number
  totalRequests: number
  requestErrors: number
  responseCodes: Record<string, number>
  registrationLatencyMs: number | null
  metricsPort: number | null
  version: string | null
  message?: string
}

function StatusBadge({ connected }: { connected: boolean }) {
  return connected ? (
    <Badge variant="default" className="bg-green-600 hover:bg-green-600 text-white gap-1">
      <Wifi className="w-3 h-3" />
      Connected
    </Badge>
  ) : (
    <Badge variant="secondary" className="bg-red-600/20 text-red-400 gap-1">
      <WifiOff className="w-3 h-3" />
      Disconnected
    </Badge>
  )
}

function MetricCard({ icon: Icon, label, value, subValue }: { 
  icon: React.ElementType
  label: string
  value: string | number
  subValue?: string 
}) {
  return (
    <div className="bg-accent/50 rounded-lg p-4 border border-border">
      <div className="flex items-center gap-2 text-muted-foreground mb-1">
        <Icon className="w-4 h-4" />
        <span className="text-sm">{label}</span>
      </div>
      <div className="text-xl font-semibold text-foreground">{value}</div>
      {subValue && <div className="text-xs text-muted-foreground mt-1">{subValue}</div>}
    </div>
  )
}

function ResponseCodeBreakdown({ codes }: { codes: Record<string, number> }) {
  const sortedCodes = Object.entries(codes).sort(([a], [b]) => a.localeCompare(b))
  
  if (sortedCodes.length === 0) return null

  const getCodeColor = (code: string) => {
    const num = parseInt(code, 10)
    if (num >= 200 && num < 300) return 'bg-green-600'
    if (num >= 300 && num < 400) return 'bg-blue-600'
    if (num >= 400 && num < 500) return 'bg-yellow-600'
    if (num >= 500) return 'bg-red-600'
    return 'bg-gray-600'
  }

  const total = sortedCodes.reduce((sum, [, count]) => sum + count, 0)

  return (
    <div className="space-y-3">
      <h4 className="text-sm font-medium text-foreground">Response Codes</h4>
      <div className="flex gap-1 h-3 rounded-full overflow-hidden bg-accent">
        {sortedCodes.map(([code, count]) => (
          <div 
            key={code}
            className={`${getCodeColor(code)} transition-all`}
            style={{ width: `${(count / total) * 100}%` }}
            title={`${code}: ${count} (${((count / total) * 100).toFixed(1)}%)`}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        {sortedCodes.map(([code, count]) => (
          <div key={code} className="flex items-center gap-1.5 text-xs">
            <div className={`w-2.5 h-2.5 rounded-full ${getCodeColor(code)}`} />
            <span className="text-muted-foreground">{code}:</span>
            <span className="font-medium text-foreground">{count.toLocaleString()}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function TunnelSettings() {
  const [copied, setCopied] = useState(false)

  const { data: status, isLoading, error } = useQuery<TunnelStatus>({
    queryKey: ['tunnel', 'status'],
    queryFn: async () => {
      const response = await apiClient.get('/api/tunnel/status')
      return response.data
    },
    refetchInterval: 10000,
  })

  const copyUrl = async () => {
    if (status?.url) {
      await navigator.clipboard.writeText(status.url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-card border border-border rounded-lg p-6">
        <div className="text-red-400">Failed to load tunnel status</div>
      </div>
    )
  }

  return (
    <div className="bg-card border border-border rounded-lg p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Cloudflare Tunnel</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Secure tunnel for remote access via Cloudflare's network
          </p>
        </div>
        <StatusBadge connected={status?.connected ?? false} />
      </div>

      {status?.url && (
        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">Tunnel URL</label>
          <div className="flex items-center gap-2">
            <div className="flex-1 bg-accent/50 border border-border rounded-lg px-4 py-3 font-mono text-sm text-foreground overflow-hidden">
              <span className="truncate block">{status.url}</span>
            </div>
            <Button variant="outline" size="icon" onClick={copyUrl} title="Copy URL">
              {copied ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
            </Button>
            <Button variant="outline" size="icon" asChild title="Open in new tab">
              <a href={status.url} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="w-4 h-4" />
              </a>
            </Button>
          </div>
        </div>
      )}

      {status?.connected && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <MetricCard
              icon={MapPin}
              label="Edge Location"
              value={status.edgeLocationFormatted || status.edgeLocation || 'Unknown'}
              subValue={status.edgeLocation ? `Code: ${status.edgeLocation}` : undefined}
            />
            <MetricCard
              icon={Activity}
              label="Total Requests"
              value={status.totalRequests.toLocaleString()}
              subValue={status.requestErrors > 0 ? `${status.requestErrors} errors` : 'No errors'}
            />
            <MetricCard
              icon={Wifi}
              label="HA Connections"
              value={status.haConnections}
              subValue="Active connections"
            />
            <MetricCard
              icon={Clock}
              label="Registration Latency"
              value={status.registrationLatencyMs ? `${status.registrationLatencyMs}ms` : 'N/A'}
              subValue="Time to connect"
            />
          </div>

          <ResponseCodeBreakdown codes={status.responseCodes} />

          <div className="pt-4 border-t border-border">
            <div className="flex items-center gap-4 text-xs text-muted-foreground">
              <div className="flex items-center gap-1.5">
                <Globe className="w-3.5 h-3.5" />
                <span>cloudflared {status.version}</span>
              </div>
              {status.metricsPort && (
                <div className="flex items-center gap-1.5">
                  <Activity className="w-3.5 h-3.5" />
                  <span>Metrics: localhost:{status.metricsPort}</span>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {!status?.connected && status?.message && (
        <div className="bg-accent/50 border border-border rounded-lg p-4 text-sm text-muted-foreground">
          {status.message}
        </div>
      )}
    </div>
  )
}
