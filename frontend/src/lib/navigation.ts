import { ASSISTANT_REPO_ID, buildServerSessionPath, buildSessionPath } from '@opencode-manager/shared/utils';
import { LOCAL_OPENCODE_SERVER_ID } from '@opencode-manager/shared/schemas';
import { getProjectHubPath } from './projectTarget';

export function getAssistantPath(): string {
  return '/assistant';
}

export function getAssistantSessionListPath(): string {
  return getProjectHubPath({ kind: 'repo', repoId: ASSISTANT_REPO_ID });
}

export function isAssistantPath(pathname: string): boolean {
  return pathname === '/assistant' || /^\/repos\/[^/]+\/assistant$/.test(pathname);
}

export function getRepoPath(repoId: number | string): string {
  return getProjectHubPath({ kind: 'repo', repoId: Number(repoId) });
}

export function getSessionPath(repoId: number | string, sessionId: string, options?: { repoTab?: string; serverId?: string }): string {
  if (options?.serverId && options.serverId !== LOCAL_OPENCODE_SERVER_ID) {
    return getServerSessionPath(options.serverId, sessionId);
  }
  return buildSessionPath(repoId, sessionId, options);
}

export function getServerSessionPath(serverId: string, sessionId: string): string {
  return buildServerSessionPath(serverId, sessionId);
}

export function getServerProjectPath(serverId: string, directory: string): string {
  return getProjectHubPath({ kind: 'server', serverId, directory });
}

export function parseServerProjectRoute(
  pathname: string,
  search: string,
): { serverId: string; directory: string } | null {
  const match = /^\/servers\/([^/]+)\/projects$/.exec(pathname);
  if (!match) return null;
  const directory = new URLSearchParams(search).get('directory');
  const serverId = decodePathSegment(match[1]);
  if (!directory || !serverId) return null;
  return { serverId, directory };
}

function decodePathSegment(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

export function parseServerSessionRoute(pathname: string): { serverId: string; sessionId: string } | null {
  const match = /^\/servers\/([^/]+)\/sessions\/([^/]+)$/.exec(pathname);
  if (!match) return null;
  const serverId = decodePathSegment(match[1]);
  const sessionId = decodePathSegment(match[2]);
  if (serverId === null || sessionId === null) return null;
  return { serverId, sessionId };
}

/**
 * Reads the session route in view, whether it belongs to the local server or a linked one.
 *
 * @param pathname Pathname of the location to read.
 * @returns The routed session and its server; both are omitted when the location is not a session route.
 */
export function parseActivePickerSession(pathname: string): { sessionId?: string; serverId?: string } {
  const repoRoute = parseRepoRoute(pathname);
  if (repoRoute.sessionId) {
    return { sessionId: repoRoute.sessionId, serverId: LOCAL_OPENCODE_SERVER_ID };
  }
  const serverSessionRoute = parseServerSessionRoute(pathname);
  if (!serverSessionRoute) return {};
  return { sessionId: serverSessionRoute.sessionId, serverId: serverSessionRoute.serverId };
}

export function isSessionDetailRoute(pathname: string): boolean {
  const normalizedPathname = pathname.replace(/\/+$/, '');
  return /^\/repos\/[^/]+\/sessions\/[^/]+$/.test(normalizedPathname) || parseServerSessionRoute(normalizedPathname) !== null;
}

export function parseRepoRoute(pathname: string): { repoId: number | null; section: string | null; sessionId: string | null } {
  const match = /^\/repos\/(\d+)(?:\/([^/]+)(?:\/([^/]+))?)?/.exec(pathname);
  if (!match) {
    return { repoId: null, section: null, sessionId: null };
  }

  const section = match[2] ?? null;
  return {
    repoId: Number(match[1]),
    section,
    sessionId: section === 'sessions' ? (match[3] ?? null) : null,
  };
}

export function getSessionListPath(repoId: string | number, isAssistantSession: boolean, tab?: string): string {
  return getProjectHubPath(
    { kind: 'repo', repoId: isAssistantSession ? ASSISTANT_REPO_ID : Number(repoId) },
    { worktrees: tab === 'workspaces' },
  );
}

function isSafeInternalPath(path: string): boolean {
  return path.startsWith('/') && !path.startsWith('//');
}

export function withQueryParam(path: string, key: string, value: string): string {
  const [base, query = ''] = path.split('?');
  const params = new URLSearchParams(query);
  params.set(key, value);
  const search = params.toString();
  return search ? `${base}?${search}` : base;
}

export function getPathWithReturnTo(path: string, returnTo: string): string {
  if (!isSafeInternalPath(returnTo)) return path;
  return withQueryParam(path, 'returnTo', returnTo);
}

export function getReturnToPath(search: string, fallback: string): string {
  const returnTo = new URLSearchParams(search).get('returnTo');
  return returnTo && isSafeInternalPath(returnTo) ? returnTo : fallback;
}
