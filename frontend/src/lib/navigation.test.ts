import { describe, it, expect } from 'vitest';
import { getSessionListPath, getSwipeBackTarget } from './navigation';

describe('getSessionListPath', () => {
  it('returns repo path for non-assistant sessions', () => {
    expect(getSessionListPath(42, false)).toBe('/repos/42');
    expect(getSessionListPath('123', false)).toBe('/repos/123');
  });

  it('returns assistant path with view=sessions for assistant sessions', () => {
    expect(getSessionListPath(42, true)).toBe('/repos/42/assistant?view=sessions');
    expect(getSessionListPath('123', true)).toBe('/repos/123/assistant?view=sessions');
  });
});

describe('getSwipeBackTarget', () => {
  describe('session detail routes', () => {
    it('returns repo path for normal session detail', () => {
      expect(getSwipeBackTarget('/repos/42/sessions/abc', '')).toBe('/repos/42');
      expect(getSwipeBackTarget('/repos/123/sessions/xyz-789', '')).toBe('/repos/123');
    });

    it('returns assistant path for assistant session detail with assistant=1', () => {
      expect(getSwipeBackTarget('/repos/42/sessions/abc', '?assistant=1')).toBe(
        '/repos/42/assistant?view=sessions'
      );
      expect(getSwipeBackTarget('/repos/123/sessions/xyz', '?assistant=1')).toBe(
        '/repos/123/assistant?view=sessions'
      );
    });

    it('returns repo path when assistant param is not 1', () => {
      expect(getSwipeBackTarget('/repos/42/sessions/abc', '?assistant=0')).toBe('/repos/42');
      expect(getSwipeBackTarget('/repos/42/sessions/abc', '?other=value')).toBe('/repos/42');
    });
  });

  describe('assistant route', () => {
    it('returns assistant sessions path for assistant route', () => {
      expect(getSwipeBackTarget('/repos/123/assistant', '')).toBe('/repos/123/assistant?view=sessions');
    });

    it('returns repo path for assistant session list route', () => {
      expect(getSwipeBackTarget('/repos/42/assistant', '?view=sessions')).toBe('/repos/42');
    });
  });

  describe('repo route', () => {
    it('returns root for repo detail', () => {
      expect(getSwipeBackTarget('/repos/42', '')).toBe('/');
      expect(getSwipeBackTarget('/repos/123', '?sort=date')).toBe('/');
    });
  });

  describe('schedules routes', () => {
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
