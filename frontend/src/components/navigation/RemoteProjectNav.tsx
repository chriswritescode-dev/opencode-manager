import { useEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { remoteProjectName, type OpenCodeProject } from '@/api/opencode'
import type { Session } from '@/api/types'
import { ActivityStateIndicator } from '@/components/activity/ActivityStateIndicator'
import { useSessionsAcrossDirectories } from '@/hooks/useOpenCode'
import { useActiveRemoteDirectory } from '@/hooks/useActiveRemoteDirectory'
import { useRemoteProjectsByActivity } from '@/hooks/useRemoteProjects'
import { useOpenCodeServers, useOpenCodeServerStatuses } from '@/hooks/useOpenCodeServers'
import { useProjectActivityState } from '@/hooks/useActiveWork'
import { useSessionSearch } from '@/hooks/useSessionSearch'
import {
  getServerProjectPath,
  getServerSessionPath,
} from '@/lib/navigation'
import { getSessionKey } from '@/lib/sessionKey'
import {
  NewSessionButton,
  RepoNavGroup,
  SessionNavLink,
  SessionNavRow,
  SessionNavStatus,
} from '@/components/navigation/RepoSessionNav'
import {
  SIDEBAR_SESSIONS_PER_REPO,
  isCurrentSessionItem,
  normalizeDirectory,
  type SidebarSessionItem,
} from '@/components/navigation/sidebar-session-tree'

function buildRemoteItem(session: Session, serverId: string, projectLabel: string): SidebarSessionItem {
  return {
    key: getSessionKey(session),
    session,
    repoId: 0,
    serverId,
    repoLabel: projectLabel,
    branchLabel: null,
    isWorktree: false,
    isPinned: false,
    path: getServerSessionPath(serverId, session.id),
  }
}

function RemoteProjectActivityIndicator({ serverId, directory }: { serverId: string; directory: string }) {
  const state = useProjectActivityState(serverId, directory)

  return <ActivityStateIndicator state={state} />
}

interface RemoteSessionRowsProps {
  serverId: string
  projectLabel: string
  sessions: Session[]
  isLoading: boolean
  isError: boolean
  hasMore?: boolean
  allSessionsPath?: string
  onSelectSession: (path: string) => void
}

function RemoteSessionRows({
  serverId,
  projectLabel,
  sessions,
  isLoading,
  isError,
  hasMore,
  allSessionsPath,
  onSelectSession,
}: RemoteSessionRowsProps) {
  const location = useLocation()
  const visibleSessions = useMemo(
    () => sessions.filter((session) => !session.time.archived),
    [sessions],
  )

  if (isLoading) return <SessionNavStatus>Loading sessions...</SessionNavStatus>
  if (isError) return <SessionNavStatus>Failed to load sessions</SessionNavStatus>
  if (visibleSessions.length === 0) return <SessionNavStatus>No sessions</SessionNavStatus>

  return (
    <>
      {visibleSessions.map((session) => {
        const item = buildRemoteItem(session, serverId, projectLabel)
        return (
          <SessionNavRow
            key={item.key}
            item={item}
            isCurrent={isCurrentSessionItem(item, location.pathname)}
            onSelect={onSelectSession}
          />
        )
      })}
      {hasMore && allSessionsPath && (
        <SessionNavLink onClick={() => onSelectSession(allSessionsPath)}>All sessions</SessionNavLink>
      )}
    </>
  )
}

interface RemoteProjectSessionsProps {
  serverId: string
  project: OpenCodeProject
  onSelectSession: (path: string) => void
}

function RemoteProjectSessions({ serverId, project, onSelectSession }: RemoteProjectSessionsProps) {
  const { data, isLoading, isError, hasNextPage } = useSessionsAcrossDirectories([project.canonical], {
    serverId,
    limit: SIDEBAR_SESSIONS_PER_REPO,
  })

  return (
    <RemoteSessionRows
      serverId={serverId}
      projectLabel={remoteProjectName(project)}
      sessions={data}
      isLoading={isLoading}
      isError={isError}
      hasMore={Boolean(hasNextPage)}
      allSessionsPath={getServerProjectPath(serverId, project.canonical)}
      onSelectSession={onSelectSession}
    />
  )
}

interface RemoteProjectGroupProps {
  serverId: string
  project: OpenCodeProject
  isOpen: boolean
  isCurrent: boolean
  onToggle?: () => void
  onOpenProject: (path: string) => void
  onSelectSession: (path: string) => void
  children: React.ReactNode
}

function RemoteProjectGroup({
  serverId,
  project,
  isOpen,
  isCurrent,
  onToggle,
  onOpenProject,
  onSelectSession,
  children,
}: RemoteProjectGroupProps) {
  const name = remoteProjectName(project)

  return (
    <RepoNavGroup
      name={name}
      branch={project.canonical}
      isOpen={isOpen}
      isCurrent={isCurrent}
      onOpenRepo={() => onOpenProject(getServerProjectPath(serverId, project.canonical))}
      onToggle={onToggle}
      indicator={<RemoteProjectActivityIndicator serverId={serverId} directory={project.canonical} />}
      actions={
        <NewSessionButton
          directory={project.canonical}
          label={name}
          serverId={serverId}
          sessionPath={(sessionId) => getServerSessionPath(serverId, sessionId)}
          onOpenSession={onSelectSession}
        />
      }
    >
      {children}
    </RepoNavGroup>
  )
}

interface RemoteProjectGroupsProps {
  serverId: string
  projects: OpenCodeProject[]
  activeDirectory: string | null
  isVisible: boolean
  onOpenProject: (path: string) => void
  onSelectSession: (path: string) => void
}

function RemoteProjectGroups({
  serverId,
  projects,
  activeDirectory,
  isVisible,
  onOpenProject,
  onSelectSession,
}: RemoteProjectGroupsProps) {
  const [expandedProjectId, setExpandedProjectId] = useState<string | null>(null)
  const normalizedActiveDirectory = normalizeDirectory(activeDirectory)

  useEffect(() => {
    if (!isVisible || !normalizedActiveDirectory) return
    const match = projects.find(
      (project) => normalizeDirectory(project.canonical) === normalizedActiveDirectory,
    )
    if (match) setExpandedProjectId(match.id)
  }, [isVisible, normalizedActiveDirectory, projects])

  return (
    <>
      {projects.map((project) => {
        const isExpanded = expandedProjectId === project.id
        return (
          <RemoteProjectGroup
            key={project.id}
            serverId={serverId}
            project={project}
            isOpen={isExpanded}
            isCurrent={normalizeDirectory(project.canonical) === normalizedActiveDirectory}
            onToggle={() =>
              setExpandedProjectId((current) => (current === project.id ? null : project.id))
            }
            onOpenProject={onOpenProject}
            onSelectSession={onSelectSession}
          >
            <RemoteProjectSessions
              serverId={serverId}
              project={project}
              onSelectSession={onSelectSession}
            />
          </RemoteProjectGroup>
        )
      })}
    </>
  )
}

interface RemoteProjectSearchResultsProps {
  serverId: string
  projects: OpenCodeProject[]
  activeDirectory: string | null
  search: string
  onOpenProject: (path: string) => void
  onSelectSession: (path: string) => void
}

function RemoteProjectSearchResults({
  serverId,
  projects,
  activeDirectory,
  search,
  onOpenProject,
  onSelectSession,
}: RemoteProjectSearchResultsProps) {
  const directories = useMemo(() => projects.map((project) => project.canonical), [projects])
  const {
    setQuery,
    filteredSessions,
    isLoading,
    isError,
  } = useSessionSearch(directories, {
    limit: SIDEBAR_SESSIONS_PER_REPO,
    serverId,
    initialQuery: search,
  })

  useEffect(() => {
    setQuery(search)
  }, [search, setQuery])

  const needle = search.trim().toLowerCase()
  const normalizedActiveDirectory = normalizeDirectory(activeDirectory)

  const nameMatchedProjects = useMemo(
    () =>
      projects.filter(
        (project) =>
          remoteProjectName(project).toLowerCase().includes(needle) ||
          project.canonical.toLowerCase().includes(needle),
      ),
    [projects, needle],
  )

  const sessionsByProjectId = useMemo(() => {
    const byDirectory = new Map<string, Session[]>()
    for (const session of filteredSessions) {
      const directory = normalizeDirectory(session.location.directory)
      if (!directory) continue
      const list = byDirectory.get(directory)
      if (list) list.push(session)
      else byDirectory.set(directory, [session])
    }

    const byProjectId = new Map<string, Session[]>()
    for (const project of projects) {
      const sessions = byDirectory.get(normalizeDirectory(project.canonical) ?? '')
      if (sessions) byProjectId.set(project.id, sessions)
    }
    return byProjectId
  }, [projects, filteredSessions])

  const visibleProjects = useMemo(() => {
    const nameMatchedIds = new Set(nameMatchedProjects.map((project) => project.id))
    return projects.filter(
      (project) => nameMatchedIds.has(project.id) || sessionsByProjectId.has(project.id),
    )
  }, [projects, nameMatchedProjects, sessionsByProjectId])

  if (isLoading) return <SessionNavStatus>Loading sessions...</SessionNavStatus>
  if (isError) return <SessionNavStatus>Failed to load sessions</SessionNavStatus>
  if (visibleProjects.length === 0) return <SessionNavStatus>No sessions found</SessionNavStatus>

  return (
    <>
      {visibleProjects.map((project) => {
        const matchedSessions = sessionsByProjectId.get(project.id)
        return (
          <RemoteProjectGroup
            key={project.id}
            serverId={serverId}
            project={project}
            isOpen
            isCurrent={normalizeDirectory(project.canonical) === normalizedActiveDirectory}
            onOpenProject={onOpenProject}
            onSelectSession={onSelectSession}
          >
            {matchedSessions ? (
              <RemoteSessionRows
                serverId={serverId}
                projectLabel={remoteProjectName(project)}
                sessions={matchedSessions}
                isLoading={false}
                isError={false}
                onSelectSession={onSelectSession}
              />
            ) : (
              <RemoteProjectSessions
                serverId={serverId}
                project={project}
                onSelectSession={onSelectSession}
              />
            )}
          </RemoteProjectGroup>
        )
      })}
    </>
  )
}

interface RemoteProjectNavListProps {
  serverId: string
  isVisible: boolean
  search?: string
  onOpenProject: (path: string) => void
  onSelectSession: (path: string) => void
}

/**
 * The linked server's projects in the sidebar, styled like the local repo groups and expanded to
 * the current project or session. Searching filters project names and that server's sessions.
 */
export function RemoteProjectNavList({
  serverId,
  isVisible,
  search = '',
  onOpenProject,
  onSelectSession,
}: RemoteProjectNavListProps) {
  const { servers, showsInitialLoading: isServersLoading } = useOpenCodeServers()
  const { statusById } = useOpenCodeServerStatuses()
  const server = servers.find((candidate) => candidate.id === serverId)
  const { directory: activeDirectory } = useActiveRemoteDirectory(serverId)

  const { projects, showsInitialLoading, showsError } = useRemoteProjectsByActivity(serverId)
  const trimmedSearch = search.trim()

  if (isServersLoading) return <SessionNavStatus>Loading projects...</SessionNavStatus>
  if (!server) return <SessionNavStatus>Server not found</SessionNavStatus>
  if (!server.enabled) return <SessionNavStatus>Server is disabled</SessionNavStatus>
  if (showsInitialLoading) return <SessionNavStatus>Loading projects...</SessionNavStatus>
  if (showsError) {
    return (
      <SessionNavStatus>
        {statusById[serverId]?.connected === false ? 'Server unreachable' : 'Could not load projects'}
      </SessionNavStatus>
    )
  }
  if (projects.length === 0) return <SessionNavStatus>No projects</SessionNavStatus>

  if (trimmedSearch) {
    return (
      <RemoteProjectSearchResults
        serverId={serverId}
        projects={projects}
        activeDirectory={activeDirectory}
        search={trimmedSearch}
        onOpenProject={onOpenProject}
        onSelectSession={onSelectSession}
      />
    )
  }

  return (
    <RemoteProjectGroups
      serverId={serverId}
      projects={projects}
      activeDirectory={activeDirectory}
      isVisible={isVisible}
      onOpenProject={onOpenProject}
      onSelectSession={onSelectSession}
    />
  )
}
