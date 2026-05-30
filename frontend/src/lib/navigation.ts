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
    return `${base}?tab=${tab}`;
  }
  return base;
}

export function getSwipeBackTarget(pathname: string, search = ''): string | null {
  const sessionDetailRegex = /^\/repos\/([^/]+)\/sessions\/[^/]+$/;
  const match = pathname.match(sessionDetailRegex);

  if (match) {
    const repoId = match[1];
    const params = new URLSearchParams(search);
    const isAssistant = params.get('assistant') === '1';
    const tab = params.get('tab') ?? undefined;
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
