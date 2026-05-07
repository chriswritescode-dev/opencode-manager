import { describe, it, expect } from 'vitest';
import { getSessionListPath, getSwipeBackTarget, getAssistantPath, getAssistantSessionListPath, isAssistantPath } from './navigation';

describe('getAssistantPath', () => {
  it('returns /assistant', () => {
    expect(getAssistantPath()).toBe('/assistant');
  });
});

describe('getAssistantSessionListPath', () => {
  it('returns /assistant?view=sessions', () => {
    expect(getAssistantSessionListPath()).toBe('/assistant?view=sessions');
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
    expect(getSessionListPath(42, true)).toBe('/assistant?view=sessions');
    expect(getSessionListPath('123', true)).toBe('/assistant?view=sessions');
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
        '/assistant?view=sessions'
      );
      expect(getSwipeBackTarget('/repos/123/sessions/xyz', '?assistant=1')).toBe(
        '/assistant?view=sessions'
      );
    });

    it('returns repo path when assistant param is not 1', () => {
      expect(getSwipeBackTarget('/repos/42/sessions/abc', '?assistant=0')).toBe('/repos/42');
      expect(getSwipeBackTarget('/repos/42/sessions/abc', '?other=value')).toBe('/repos/42');
    });
  });

  describe('assistant route', () => {
    it('returns assistant session list path for canonical assistant route', () => {
      expect(getSwipeBackTarget('/assistant', '')).toBe('/assistant?view=sessions');
    });

    it('returns root for assistant session list route', () => {
      expect(getSwipeBackTarget('/assistant', '?view=sessions')).toBe('/');
    });

    it('returns assistant session list path for legacy assistant route', () => {
      expect(getSwipeBackTarget('/repos/123/assistant', '')).toBe('/assistant?view=sessions');
    });

    it('returns root for legacy assistant session list route', () => {
      expect(getSwipeBackTarget('/repos/42/assistant', '?view=sessions')).toBe('/');
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
