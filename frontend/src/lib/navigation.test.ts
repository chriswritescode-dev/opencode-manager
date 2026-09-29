import { describe, it, expect } from 'vitest';
import { getSessionListPath, getSwipeBackTarget, getAssistantPath, getAssistantSessionListPath, isAssistantPath, getPathWithReturnTo, getReturnToPath, getRepoPath, getSessionPath, parseRepoRoute } from './navigation';

describe('getAssistantPath', () => {
  it('returns /assistant', () => {
    expect(getAssistantPath()).toBe('/assistant');
  });
});

describe('getAssistantSessionListPath', () => {
  it('returns /assistant', () => {
    expect(getAssistantSessionListPath()).toBe('/assistant');
  });
});

describe('isAssistantPath', () => {
  it('returns true for /assistant', () => {
    expect(isAssistantPath('/assistant')).toBe(true);
  });

  it('returns true for legacy /repos/0/assistant', () => {
    expect(isAssistantPath('/repos/0/assistant')).toBe(true);
  });

  it('returns true for legacy /repos/5/assistant', () => {
    expect(isAssistantPath('/repos/5/assistant')).toBe(true);
  });

  it('returns false for /repos/5', () => {
    expect(isAssistantPath('/repos/5')).toBe(false);
  });

  it('returns false for /schedules', () => {
    expect(isAssistantPath('/schedules')).toBe(false);
  });
});

describe('getSessionListPath', () => {
  it('returns repo path for non-assistant sessions', () => {
    expect(getSessionListPath(42, false)).toBe('/repos/42');
    expect(getSessionListPath('123', false)).toBe('/repos/123');
  });

  it('returns assistant session list path for assistant sessions', () => {
    expect(getSessionListPath(42, true)).toBe('/assistant');
    expect(getSessionListPath('123', true)).toBe('/assistant');
  });

  it('includes tab param when tab is workspaces', () => {
    expect(getSessionListPath(42, false, 'workspaces')).toBe('/repos/42?repoTab=workspaces');
  });

  it('omits tab param for repo/default tab', () => {
    expect(getSessionListPath(42, false, 'repo')).toBe('/repos/42');
    expect(getSessionListPath(42, false, undefined)).toBe('/repos/42');
  });

  it('ignores tab param for assistant sessions', () => {
    expect(getSessionListPath(42, true, 'workspaces')).toBe('/assistant');
  });
});

describe('getSessionPath', () => {
  it('builds a session detail path from a numeric or string repo id', () => {
    expect(getSessionPath(5, 'ses_1')).toBe('/repos/5/sessions/ses_1');
    expect(getSessionPath('5', 'ses_1')).toBe('/repos/5/sessions/ses_1');
  });

  it('marks assistant repo sessions with the assistant param', () => {
    expect(getSessionPath(0, 'ses_1')).toBe('/repos/0/sessions/ses_1?assistant=1');
    expect(getSessionPath('0', 'ses_1')).toBe('/repos/0/sessions/ses_1?assistant=1');
  });
});

describe('getRepoPath', () => {
  it('routes the assistant repo to the assistant page and others to their repo page', () => {
    expect(getRepoPath(0)).toBe('/assistant');
    expect(getRepoPath(5)).toBe('/repos/5');
  });
});

describe('parseRepoRoute', () => {
  it('parses a repo and session route', () => {
    expect(parseRepoRoute('/repos/5/sessions/ses_1')).toEqual({
      repoId: 5,
      section: 'sessions',
      sessionId: 'ses_1',
    });
  });

  it('parses a repo route without a section', () => {
    expect(parseRepoRoute('/repos/5')).toEqual({ repoId: 5, section: null, sessionId: null });
  });

  it('parses a repo section route without a session id', () => {
    expect(parseRepoRoute('/repos/5/schedules')).toEqual({
      repoId: 5,
      section: 'schedules',
      sessionId: null,
    });
    expect(parseRepoRoute('/repos/5/sessions')).toEqual({
      repoId: 5,
      section: 'sessions',
      sessionId: null,
    });
  });

  it('returns nulls for an unrelated route', () => {
    expect(parseRepoRoute('/')).toEqual({ repoId: null, section: null, sessionId: null });
  });
});

describe('return target helpers', () => {
  it('adds encoded returnTo params for internal paths', () => {
    expect(getPathWithReturnTo('/repos/5/schedules', '/repos/5/sessions/abc?assistant=1')).toBe(
      '/repos/5/schedules?returnTo=%2Frepos%2F5%2Fsessions%2Fabc%3Fassistant%3D1'
    );
  });

  it('reads returnTo params and falls back for unsafe values', () => {
    expect(getReturnToPath('?returnTo=%2Frepos%2F5%2Fsessions%2Fabc%3Fassistant%3D1', '/repos/5')).toBe(
      '/repos/5/sessions/abc?assistant=1'
    );
    expect(getReturnToPath('?returnTo=https%3A%2F%2Fexample.com', '/repos/5')).toBe('/repos/5');
  });
});

describe('getSwipeBackTarget', () => {
  describe('session detail routes', () => {
    it('returns repo path for normal session detail', () => {
      expect(getSwipeBackTarget('/repos/42/sessions/abc', '')).toBe('/repos/42');
      expect(getSwipeBackTarget('/repos/123/sessions/xyz-789', '')).toBe('/repos/123');
    });

    it('returns assistant session list path for assistant session detail with assistant=1', () => {
      expect(getSwipeBackTarget('/repos/42/sessions/abc', '?assistant=1')).toBe(
        '/assistant'
      );
      expect(getSwipeBackTarget('/repos/123/sessions/xyz', '?assistant=1')).toBe(
        '/assistant'
      );
    });

    it('returns repo path when assistant param is not 1', () => {
      expect(getSwipeBackTarget('/repos/42/sessions/abc', '?assistant=0')).toBe('/repos/42');
      expect(getSwipeBackTarget('/repos/42/sessions/abc', '?other=value')).toBe('/repos/42');
    });

    it('preserves tab param in back target', () => {
      expect(getSwipeBackTarget('/repos/42/sessions/abc', '?repoTab=workspaces')).toBe('/repos/42?repoTab=workspaces');
      expect(getSwipeBackTarget('/repos/42/sessions/abc', '?repoTab=workspaces&assistant=1')).toBe(
        '/assistant'
      );
    });
  });

  describe('assistant route', () => {
    it('returns root for canonical assistant route', () => {
      expect(getSwipeBackTarget('/assistant', '')).toBe('/');
    });

    it('returns root for legacy assistant route', () => {
      expect(getSwipeBackTarget('/repos/123/assistant', '')).toBe('/');
    });
  });

  describe('repo route', () => {
    it('returns root for repo detail', () => {
      expect(getSwipeBackTarget('/repos/42', '')).toBe('/');
      expect(getSwipeBackTarget('/repos/123', '?sort=date')).toBe('/');
    });
  });

  describe('schedules routes', () => {
    it('returns /assistant for assistant schedules', () => {
      expect(getSwipeBackTarget('/repos/0/schedules', '')).toBe('/assistant');
    });

    it('returns repo path for repo schedules', () => {
      expect(getSwipeBackTarget('/repos/42/schedules', '')).toBe('/repos/42');
    });

    it('returns returnTo path for repo schedules when present', () => {
      expect(getSwipeBackTarget('/repos/42/schedules', '?returnTo=%2Frepos%2F42%2Fsessions%2Fabc%3Fassistant%3D1')).toBe(
        '/repos/42/sessions/abc?assistant=1'
      );
    });

    it('returns root for top-level schedules', () => {
      expect(getSwipeBackTarget('/schedules', '')).toBe('/');
    });
  });

  describe('null returns', () => {
    it('returns null for root path', () => {
      expect(getSwipeBackTarget('/', '')).toBeNull();
    });

    it('returns null for login', () => {
      expect(getSwipeBackTarget('/login', '')).toBeNull();
    });

    it('returns null for setup', () => {
      expect(getSwipeBackTarget('/setup', '')).toBeNull();
    });

    it('returns null for register', () => {
      expect(getSwipeBackTarget('/register', '')).toBeNull();
    });

    it('returns null for unknown paths', () => {
      expect(getSwipeBackTarget('/unknown/path', '')).toBeNull();
      expect(getSwipeBackTarget('/api/something', '')).toBeNull();
    });
  });
});
