import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import type { UseQueryResult } from '@tanstack/react-query'
import type { SessionInfo } from '@opencode-manager/shared/opencode'
import { LOCAL_OPENCODE_SERVER_ID } from '@opencode-manager/shared/schemas'
import type { SessionUsageMessages } from '@/api/usage'
import { findRepoForDirectory } from '@/components/navigation/sidebar-session-tree'
import { ErrorBanner } from '@/components/ui/error-banner'
import { useSessionsAcrossDirectories } from '@/hooks/useOpenCode'
import { useNavigableRepos } from '@/hooks/useSidebarRepoGroups'
import { useSessionUsageQueries } from '@/hooks/useUsage'
import { formatCompactTokens } from '@/lib/contextUsage'
import { getServerSessionPath, getSessionPath, withQueryParam } from '@/lib/navigation'
import type { ResolvedUsageRange } from '@/lib/usageRange'
import {
  formatTokensPerSecond,
  formatUsd,
  summarizeSessionSteps,
  totalTokens,
} from '@/lib/usageStats'

interface UsageSessionsTableProps {
  serverId: string
  range: ResolvedUsageRange
}

interface SessionMetrics {
  steps: string
  throughput: string
}

const SESSION_PAGE_LIMIT = 100
const MAX_SESSION_PAGES = 5
const SESSION_CAP = SESSION_PAGE_LIMIT * MAX_SESSION_PAGES
const INITIAL_ROWS = 10
const ROW_INCREMENT = 10

function hasSpendOrTokens(session: SessionInfo): boolean {
  return session.cost > 0 || totalTokens(session.tokens) > 0
}

function isSessionActiveFrom(session: SessionInfo, range: ResolvedUsageRange): boolean {
  return range.from === undefined || session.time.updated >= range.from
}

const sessionMetricsCache = new WeakMap<SessionUsageMessages, SessionMetrics>()

function sessionMetrics(
  query: UseQueryResult<SessionUsageMessages> | undefined,
): SessionMetrics {
  if (!query || query.isPending) return { steps: '…', throughput: '…' }
  if (!query.data) return { steps: '—', throughput: '—' }
  const cached = sessionMetricsCache.get(query.data)
  if (cached) return cached
  const summary = summarizeSessionSteps(query.data.steps, { range: {}, models: [] })
  const metrics = {
    steps: query.data.truncated ? `${summary.steps}+` : String(summary.steps),
    throughput: formatTokensPerSecond(summary.averageTokensPerSecond),
  }
  sessionMetricsCache.set(query.data, metrics)
  return metrics
}

export function UsageSessionsTable({ serverId, range }: UsageSessionsTableProps) {
  const {
    data: sessions,
    isLoading,
    isError,
    error,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useSessionsAcrossDirectories([], {
    allDirectories: true,
    limit: SESSION_PAGE_LIMIT,
    serverId,
  })
  const isLocal = serverId === LOCAL_OPENCODE_SERVER_ID
  const { repos } = useNavigableRepos(isLocal)
  const location = useLocation()
  const [showCount, setShowCount] = useState(INITIAL_ROWS)

  const panelId = useMemo(
    () => new URLSearchParams(location.search).get('panel'),
    [location.search],
  )

  const hasLoadedSessions = sessions.length > 0
  const oldestLoadedUpdated = hasLoadedSessions
    ? sessions[sessions.length - 1].time.updated
    : undefined
  const isOldestLoadedInRange =
    range.from === undefined ||
    (oldestLoadedUpdated !== undefined && oldestLoadedUpdated >= range.from)
  const isAtSessionCap = sessions.length >= SESSION_CAP
  const showsCapNote = isAtSessionCap && hasNextPage && isOldestLoadedInRange

  useEffect(() => {
    if (!hasLoadedSessions || !hasNextPage || isFetchingNextPage || isError) return
    if (isAtSessionCap || !isOldestLoadedInRange) return
    void fetchNextPage()
  }, [
    fetchNextPage,
    hasLoadedSessions,
    hasNextPage,
    isAtSessionCap,
    isError,
    isFetchingNextPage,
    isOldestLoadedInRange,
    sessions.length,
  ])

  const sortedSessions = useMemo(
    () =>
      sessions
        .filter((session) => isSessionActiveFrom(session, range) && hasSpendOrTokens(session))
        .sort((a, b) => b.cost - a.cost || totalTokens(b.tokens) - totalTokens(a.tokens)),
    [sessions, range],
  )

  const visibleSessions = sortedSessions.slice(0, showCount)
  const usageQueries = useSessionUsageQueries(
    visibleSessions.map((session) => session.id),
    serverId,
  )

  function sessionLinkPath(path: string): string {
    return panelId ? withQueryParam(path, 'panel', panelId) : path
  }

  function renderTitle(session: SessionInfo) {
    const title = session.title ?? session.id
    if (isLocal) {
      const repo = findRepoForDirectory(repos, session.location.directory)
      if (repo) {
        return (
          <Link
            to={sessionLinkPath(getSessionPath(repo.id, session.id))}
            className="transition-colors hover:text-primary"
          >
            {title}
          </Link>
        )
      }
      return <span>{title}</span>
    }
    return (
      <Link
        to={sessionLinkPath(getServerSessionPath(serverId, session.id))}
        className="transition-colors hover:text-primary"
      >
        {title}
      </Link>
    )
  }

  return (
    <div className="space-y-3">
      <h2 className="text-sm font-medium">Sessions by spend</h2>
      <p className="text-xs text-muted-foreground">
        Lifetime totals of sessions active in this range.
      </p>
      {isError && sessions.length === 0 ? (
        <ErrorBanner
          title="Sessions unavailable"
          summary="This OpenCode server could not list its sessions."
          detail={error instanceof Error ? error.message : undefined}
        />
      ) : isLoading && sortedSessions.length === 0 ? (
        <p className="text-sm text-muted-foreground">Loading sessions…</p>
      ) : sortedSessions.length === 0 ? (
        <p className="text-sm text-muted-foreground">No sessions in this range.</p>
      ) : (
        <>
          <table className="w-full text-sm">
            <thead className="border-b border-border/60 text-xs uppercase text-muted-foreground">
              <tr>
                <th scope="col" className="px-3 py-2.5 text-left font-medium">
                  Session
                </th>
                <th scope="col" className="px-3 py-2.5 text-right font-medium">
                  Steps
                </th>
                <th scope="col" className="px-3 py-2.5 text-right font-medium">
                  Input
                </th>
                <th scope="col" className="px-3 py-2.5 text-right font-medium">
                  Output
                </th>
                <th scope="col" className="px-3 py-2.5 text-right font-medium">
                  Cache read
                </th>
                <th scope="col" className="px-3 py-2.5 text-right font-medium">
                  Avg tokens/s
                </th>
                <th scope="col" className="px-3 py-2.5 text-right font-medium">
                  Cost
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {visibleSessions.map((session, index) => {
                const metrics = sessionMetrics(usageQueries[index])
                return (
                  <tr key={session.id}>
                    <td className="px-3 py-2.5">{renderTitle(session)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{metrics.steps}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {formatCompactTokens(session.tokens.input)}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {formatCompactTokens(session.tokens.output)}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {formatCompactTokens(session.tokens.cache.read)}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{metrics.throughput}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {formatUsd(session.cost)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {sortedSessions.length > showCount && (
            <button
              type="button"
              onClick={() => setShowCount((count) => count + ROW_INCREMENT)}
              className="text-xs font-medium text-primary hover:underline"
            >
              Show more
            </button>
          )}
          {showsCapNote && (
            <p className="text-xs text-muted-foreground">
              {`Ranked from the ${SESSION_CAP} most recently active sessions.`}
            </p>
          )}
        </>
      )}
      {isError && sessions.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Some sessions could not be loaded, so this ranking may be incomplete.
        </p>
      )}
    </div>
  )
}
