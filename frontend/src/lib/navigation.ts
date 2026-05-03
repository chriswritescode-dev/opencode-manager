export function getSessionListPath(repoId: string | number, isAssistantSession: boolean): string {
  const id = String(repoId);
  if (isAssistantSession) {
    return `/repos/${id}/assistant?view=sessions`;
  }
  return `/repos/${id}`;
}

export function getSwipeBackTarget(pathname: string, search = ''): string | null {
  const sessionDetailRegex = /^\/repos\/([^/]+)\/sessions\/[^/]+$/;
  const match = pathname.match(sessionDetailRegex);

  if (match) {
    const repoId = match[1];
    const params = new URLSearchParams(search);
    const isAssistant = params.get('assistant') === '1';
    return getSessionListPath(repoId, isAssistant);
  }

  if (pathname === '/repos/:id/assistant' || /^\/repos\/[^/]+\/assistant$/.test(pathname)) {
    const repoId = pathname.split('/')[2];
    const params = new URLSearchParams(search);
    if (params.get('view') !== 'sessions') {
      return getSessionListPath(repoId, true);
    }
    return `/repos/${repoId}`;
  }

  if (/^\/repos\/[^/]+$/.test(pathname)) {
    return '/';
  }

  if (/^\/repos\/[^/]+\/schedules$/.test(pathname)) {
    const repoId = pathname.split('/')[2];
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
