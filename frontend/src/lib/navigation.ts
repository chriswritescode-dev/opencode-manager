import { ASSISTANT_REPO_ID } from '@opencode-manager/shared/utils';

export function getAssistantPath(): string {
  return '/assistant';
}

export function getAssistantSessionListPath(): string {
  return '/assistant';
}

export function isAssistantPath(pathname: string): boolean {
  return pathname === '/assistant' || /^\/repos\/[^/]+\/assistant$/.test(pathname);
}

function isAssistantRepo(repoId: number | string): boolean {
  return String(repoId) === String(ASSISTANT_REPO_ID);
}

export function getRepoPath(repoId: number | string): string {
  return isAssistantRepo(repoId) ? getAssistantPath() : `/repos/${repoId}`;
}

export function getSessionPath(repoId: number | string, sessionId: string): string {
  const suffix = isAssistantRepo(repoId) ? '?assistant=1' : '';
  return `/repos/${repoId}/sessions/${sessionId}${suffix}`;
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
  if (isAssistantSession) {
    return getAssistantSessionListPath();
  }
  const base = `/repos/${String(repoId)}`;
  if (tab && tab !== 'repo') {
    return `${base}?repoTab=${tab}`;
  }
  return base;
}

function isSafeInternalPath(path: string): boolean {
  return path.startsWith('/') && !path.startsWith('//');
}

export function getPathWithReturnTo(path: string, returnTo: string): string {
  if (!isSafeInternalPath(returnTo)) return path;
  const [base, query = ''] = path.split('?');
  const params = new URLSearchParams(query);
  params.set('returnTo', returnTo);
  const search = params.toString();
  return search ? `${base}?${search}` : base;
}

export function getReturnToPath(search: string, fallback: string): string {
  const returnTo = new URLSearchParams(search).get('returnTo');
  return returnTo && isSafeInternalPath(returnTo) ? returnTo : fallback;
}

export function getSwipeBackTarget(pathname: string, search = ''): string | null {
  const sessionDetailRegex = /^\/repos\/([^/]+)\/sessions\/[^/]+$/;
  const match = pathname.match(sessionDetailRegex);

  if (match) {
    const repoId = match[1];
    const params = new URLSearchParams(search);
    const isAssistant = params.get('assistant') === '1';
    const tab = params.get('repoTab') ?? undefined;
    return getSessionListPath(repoId, isAssistant, tab);
  }

  if (isAssistantPath(pathname)) {
    return '/';
  }

  if (/^\/repos\/[^/]+$/.test(pathname)) {
    return '/';
  }

  if (/^\/repos\/[^/]+\/schedules$/.test(pathname)) {
    const returnTo = getReturnToPath(search, '');
    if (returnTo) return returnTo;
    const repoId = pathname.split('/')[2];
    if (repoId === '0') {
      return getAssistantPath();
    }
    return `/repos/${repoId}`;
  }

  if (pathname === '/schedules') {
    return '/';
  }

  if (pathname === '/' || pathname === '/login' || pathname === '/setup' || pathname === '/register') {
    return null;
  }

  return null;
}
