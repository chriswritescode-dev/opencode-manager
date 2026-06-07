export function getAssistantPath(): string {
  return '/assistant';
}

export function getAssistantSessionListPath(): string {
  return '/assistant?view=sessions';
}

export function isAssistantPath(pathname: string): boolean {
  return pathname === '/assistant' || /^\/repos\/[^/]+\/assistant$/.test(pathname);
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
    const params = new URLSearchParams(search);
    if (params.get('view') !== 'sessions') {
      return getAssistantSessionListPath();
    }
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
