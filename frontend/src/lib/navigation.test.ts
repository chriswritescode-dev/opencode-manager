import { describe, it, expect } from 'vitest';
import { getSessionListPath, getSwipeBackTarget, getAssistantPath, getAssistantSessionListPath, isAssistantPath, getPathWithReturnTo, getReturnToPath, getRepoPath, getServerProjectPath, getServerSessionPath, getSessionPath, isSessionDetailRoute, parseActivePickerSession, parseRepoRoute, parseServerProjectRoute, parseServerSessionRoute } from './navigation';
import { LOCAL_OPENCODE_SERVER_ID } from '@opencode-manager/shared/schemas';

describe('getAssistantPath', () => {
  it('returns /assistant', () => {
    expect(getAssistantPath()).toBe('/assistant');
  });
});

describe('getAssistantSessionListPath', () => {
  it('returns the Assistant hub path', () => {
    expect(getAssistantSessionListPath()).toBe('/?menu=sessions&menuProject=repo:0');
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
  it('returns the repo hub path for non-assistant sessions', () => {
    expect(getSessionListPath(42, false)).toBe('/?menu=sessions&menuProject=repo:42');
    expect(getSessionListPath('123', false)).toBe('/?menu=sessions&menuProject=repo:123');
  });

  it('returns the Assistant hub path for assistant sessions', () => {
    expect(getSessionListPath(42, true)).toBe('/?menu=sessions&menuProject=repo:0');
    expect(getSessionListPath('123', true)).toBe('/?menu=sessions&menuProject=repo:0');
  });

  it('includes the workspaces tab when tab is workspaces', () => {
    expect(getSessionListPath(42, false, 'workspaces')).toBe(
      '/?menu=sessions&menuProject=repo:42&repoTab=workspaces',
    );
    expect(getSessionListPath(42, true, 'workspaces')).toBe(
      '/?menu=sessions&menuProject=repo:0&repoTab=workspaces',
    );
  });

  it('omits the tab param for repo/default tab', () => {
    expect(getSessionListPath(42, false, 'repo')).toBe('/?menu=sessions&menuProject=repo:42');
    expect(getSessionListPath(42, false, undefined)).toBe('/?menu=sessions&menuProject=repo:42');
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

  it('includes a repoTab query param when provided', () => {
    expect(getSessionPath(5, 'ses_1', { repoTab: 'workspaces' })).toBe('/repos/5/sessions/ses_1?repoTab=workspaces');
  });

  it('combines the assistant and repoTab query params', () => {
    expect(getSessionPath(0, 'ses_1', { repoTab: 'workspaces' })).toBe(
      '/repos/0/sessions/ses_1?assistant=1&repoTab=workspaces'
    );
  });

  it('builds a linked server session path for a remote server id', () => {
    expect(getSessionPath(0, 'ses_1', { serverId: 'srv_kitchen' })).toBe(
      '/servers/srv_kitchen/sessions/ses_1'
    );
    expect(getSessionPath(5, 'ses_1', { repoTab: 'workspaces', serverId: 'srv_kitchen' })).toBe(
      '/servers/srv_kitchen/sessions/ses_1'
    );
  });

  it('keeps local repo paths when the server id is local', () => {
    expect(getSessionPath(5, 'ses_1', { serverId: 'local' })).toBe('/repos/5/sessions/ses_1');
  });
});

describe('linked server paths', () => {
  it('builds server and server session paths with encoded segments', () => {
    expect(getServerSessionPath('srv_kitchen', 'ses_1')).toBe('/servers/srv_kitchen/sessions/ses_1');
    expect(getServerSessionPath('srv a/b', 'ses 1')).toBe('/servers/srv%20a%2Fb/sessions/ses%201');
  });
});

describe('getRepoPath', () => {
  it('routes every repo, including the Assistant, to its hub path', () => {
    expect(getRepoPath(0)).toBe('/?menu=sessions&menuProject=repo:0');
    expect(getRepoPath(5)).toBe('/?menu=sessions&menuProject=repo:5');
    expect(getRepoPath('5')).toBe('/?menu=sessions&menuProject=repo:5');
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

describe('linked server project paths', () => {
  it('builds a hub path with the encoded server id and directory', () => {
    expect(getServerProjectPath('srv_kitchen', '/home/me/app')).toBe(
      '/?menu=sessions&menuProject=server:srv_kitchen:%252Fhome%252Fme%252Fapp'
    );
    expect(getServerProjectPath('srv a/b', '/srv/my app')).toBe(
      '/?menu=sessions&menuProject=server:srv%2520a%252Fb:%252Fsrv%252Fmy%2520app'
    );
  });

  it('parses the server id and decoded directory from a project route', () => {
    expect(
      parseServerProjectRoute('/servers/srv_kitchen/projects', '?directory=%2Fhome%2Fme%2Fapp')
    ).toEqual({ serverId: 'srv_kitchen', directory: '/home/me/app' });
  });

  it('returns null without a directory or for other routes', () => {
    expect(parseServerProjectRoute('/servers/srv_kitchen/projects', '')).toBeNull();
    expect(parseServerProjectRoute('/servers/srv_kitchen', '?directory=%2Fhome%2Fme')).toBeNull();
  });
});

describe('parseServerSessionRoute', () => {
  it('parses a linked-server session route', () => {
    expect(parseServerSessionRoute('/servers/srv_kitchen/sessions/ses_1')).toEqual({
      serverId: 'srv_kitchen',
      sessionId: 'ses_1',
    });
  });

  it('returns null for other routes', () => {
    expect(parseServerSessionRoute('/servers/srv_kitchen')).toBeNull();
    expect(parseServerSessionRoute('/repos/5/sessions/ses_1')).toBeNull();
  });

  it('returns null for a malformed server id segment', () => {
    expect(parseServerSessionRoute('/servers/%E0%A4%A/sessions/ses_1')).toBeNull();
  });

  it('returns null for a malformed session id segment', () => {
    expect(parseServerSessionRoute('/servers/srv_kitchen/sessions/%E0%A4%A')).toBeNull();
  });

  it('decodes valid encoded segments', () => {
    expect(parseServerSessionRoute('/servers/srv%20a%2Fb/sessions/ses%201')).toEqual({
      serverId: 'srv a/b',
      sessionId: 'ses 1',
    });
  });
});

describe('parseActivePickerSession', () => {
  it('reads a local session route on the local server', () => {
    expect(parseActivePickerSession('/repos/5/sessions/ses_1')).toEqual({
      sessionId: 'ses_1',
      serverId: LOCAL_OPENCODE_SERVER_ID,
    });
  });

  it('reads a linked-server session route on its own server', () => {
    expect(parseActivePickerSession('/servers/srv_kitchen/sessions/ses_1')).toEqual({
      sessionId: 'ses_1',
      serverId: 'srv_kitchen',
    });
  });

  it('returns no session outside a session route', () => {
    expect(parseActivePickerSession('/repos/5')).toEqual({});
    expect(parseActivePickerSession('/servers/srv_kitchen/projects')).toEqual({});
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

describe('isSessionDetailRoute', () => {
  it('matches local session detail routes', () => {
    expect(isSessionDetailRoute('/repos/42/sessions/abc')).toBe(true);
    expect(isSessionDetailRoute('/repos/0/sessions/ses_assistant')).toBe(true);
  });

  it('matches linked server session detail routes', () => {
    expect(isSessionDetailRoute('/servers/srv_kitchen/sessions/ses_abc')).toBe(true);
    expect(isSessionDetailRoute('/servers/https%3A%2F%2Fhost/sessions/ses_abc')).toBe(true);
  });

  it('matches trailing-slash session detail routes', () => {
    expect(isSessionDetailRoute('/repos/42/sessions/abc/')).toBe(true);
    expect(isSessionDetailRoute('/servers/srv_kitchen/sessions/ses_abc/')).toBe(true);
  });

  it('rejects everything else', () => {
    expect(isSessionDetailRoute('/')).toBe(false);
    expect(isSessionDetailRoute('/repos/42')).toBe(false);
    expect(isSessionDetailRoute('/servers/srv_kitchen/projects')).toBe(false);
    expect(isSessionDetailRoute('/servers/srv_kitchen/sessions')).toBe(false);
    expect(isSessionDetailRoute('/assistant')).toBe(false);
  });
});

describe('getSwipeBackTarget', () => {
  describe('session detail routes', () => {
    it('returns the repo hub path for a normal session detail', () => {
      expect(getSwipeBackTarget('/repos/42/sessions/abc', '')).toBe(
        '/?menu=sessions&menuProject=repo:42'
      );
      expect(getSwipeBackTarget('/repos/123/sessions/xyz-789', '')).toBe(
        '/?menu=sessions&menuProject=repo:123'
      );
    });

    it('returns the Assistant hub path for assistant session detail with assistant=1', () => {
      expect(getSwipeBackTarget('/repos/42/sessions/abc', '?assistant=1')).toBe(
        '/?menu=sessions&menuProject=repo:0'
      );
      expect(getSwipeBackTarget('/repos/123/sessions/xyz', '?assistant=1')).toBe(
        '/?menu=sessions&menuProject=repo:0'
      );
    });

    it('returns the repo hub path when assistant param is not 1', () => {
      expect(getSwipeBackTarget('/repos/42/sessions/abc', '?assistant=0')).toBe(
        '/?menu=sessions&menuProject=repo:42'
      );
      expect(getSwipeBackTarget('/repos/42/sessions/abc', '?other=value')).toBe(
        '/?menu=sessions&menuProject=repo:42'
      );
    });

    it('preserves the workspaces tab in the back target', () => {
      expect(getSwipeBackTarget('/repos/42/sessions/abc', '?repoTab=workspaces')).toBe(
        '/?menu=sessions&menuProject=repo:42&repoTab=workspaces'
      );
      expect(getSwipeBackTarget('/repos/42/sessions/abc', '?repoTab=workspaces&assistant=1')).toBe(
        '/?menu=sessions&menuProject=repo:0&repoTab=workspaces'
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

  describe('linked server routes', () => {
    it('returns root for a remote session detail', () => {
      expect(getSwipeBackTarget('/servers/srv_kitchen/sessions/ses_1', '')).toBe('/');
    });

    it('returns root for a server page', () => {
      expect(getSwipeBackTarget('/servers/srv_kitchen', '')).toBe('/');
    });

    it('returns root for a remote project page', () => {
      expect(
        getSwipeBackTarget('/servers/srv_kitchen/projects', '?directory=%2Fhome%2Fme%2Fapp')
      ).toBe('/');
    });

    it('does not throw for a malformed server session path', () => {
      expect(() => getSwipeBackTarget('/servers/%E0%A4%A/sessions/ses_1', '')).not.toThrow();
      expect(getSwipeBackTarget('/servers/%E0%A4%A/sessions/ses_1', '')).toBeNull();
      expect(() => getSwipeBackTarget('/servers/srv_kitchen/sessions/%E0%A4%A', '')).not.toThrow();
      expect(getSwipeBackTarget('/servers/srv_kitchen/sessions/%E0%A4%A', '')).toBeNull();
      expect(() => getSwipeBackTarget('/servers/%E0%A4%A/projects', '?directory=%2Fa')).not.toThrow();
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
