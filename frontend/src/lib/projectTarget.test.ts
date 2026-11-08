import { describe, it, expect } from 'vitest';
import {
  encodeProjectTarget,
  getProjectHubPath,
  isSameProjectTarget,
  parseProjectTarget,
  projectTargetFromRoute,
  type ProjectTarget,
} from './projectTarget';

const repoTarget: ProjectTarget = { kind: 'repo', repoId: 7 };
const assistantTarget: ProjectTarget = { kind: 'repo', repoId: 0 };
const serverTarget: ProjectTarget = { kind: 'server', serverId: 'srv_kitchen', directory: '/home/me/app' };
const awkwardServerTarget: ProjectTarget = {
  kind: 'server',
  serverId: 'srv a:b/c',
  directory: '/srv/my app: 100%2Fdone',
};

describe('project target encoding', () => {
  it.each<ProjectTarget>([repoTarget, assistantTarget, serverTarget, awkwardServerTarget])(
    'round trips %o',
    (target) => {
      expect(parseProjectTarget(encodeProjectTarget(target))).toEqual(target);
    },
  );

  it('encodes repo and server targets distinctly', () => {
    expect(encodeProjectTarget(repoTarget)).toBe('repo:7');
    expect(encodeProjectTarget(serverTarget)).toBe('server:srv_kitchen:%2Fhome%2Fme%2Fapp');
  });

  it('rejects missing and malformed values', () => {
    expect(parseProjectTarget(null)).toBeNull();
    expect(parseProjectTarget('')).toBeNull();
    expect(parseProjectTarget('repo')).toBeNull();
    expect(parseProjectTarget('repo:')).toBeNull();
    expect(parseProjectTarget('repo:abc')).toBeNull();
    expect(parseProjectTarget('repo:-1')).toBeNull();
    expect(parseProjectTarget('server:')).toBeNull();
    expect(parseProjectTarget('server:srv_kitchen')).toBeNull();
    expect(parseProjectTarget('server:srv_kitchen:')).toBeNull();
    expect(parseProjectTarget('server::%2Fhome')).toBeNull();
    expect(parseProjectTarget('other:1')).toBeNull();
    expect(parseProjectTarget('server:%E0%A4%A:%2Fhome')).toBeNull();
  });
});

describe('isSameProjectTarget', () => {
  it('matches identical targets', () => {
    expect(isSameProjectTarget(repoTarget, { kind: 'repo', repoId: 7 })).toBe(true);
    expect(isSameProjectTarget(serverTarget, { ...serverTarget })).toBe(true);
    expect(isSameProjectTarget(null, null)).toBe(true);
  });

  it('separates different targets', () => {
    expect(isSameProjectTarget(repoTarget, { kind: 'repo', repoId: 8 })).toBe(false);
    expect(isSameProjectTarget(repoTarget, serverTarget)).toBe(false);
    expect(isSameProjectTarget(serverTarget, { ...serverTarget, directory: '/other' })).toBe(false);
    expect(isSameProjectTarget(repoTarget, null)).toBe(false);
    expect(isSameProjectTarget(null, repoTarget)).toBe(false);
  });
});

describe('projectTargetFromRoute', () => {
  it('reads repo routes', () => {
    expect(projectTargetFromRoute('/repos/5', '')).toEqual({ kind: 'repo', repoId: 5 });
    expect(projectTargetFromRoute('/repos/5/sessions/ses_1', '')).toEqual({ kind: 'repo', repoId: 5 });
  });

  it('reads assistant routes as repo 0', () => {
    expect(projectTargetFromRoute('/assistant', '')).toEqual(assistantTarget);
    expect(projectTargetFromRoute('/repos/5/assistant', '')).toEqual(assistantTarget);
    expect(projectTargetFromRoute('/repos/5/sessions/ses_1', '?assistant=1')).toEqual(assistantTarget);
    expect(projectTargetFromRoute('/repos/5/sessions/ses_1', '?assistant=0')).toEqual({
      kind: 'repo',
      repoId: 5,
    });
  });

  it('reads linked-server project and session routes', () => {
    expect(projectTargetFromRoute('/servers/srv_kitchen/projects', '?directory=%2Fhome%2Fme%2Fapp')).toEqual(
      serverTarget,
    );
    expect(projectTargetFromRoute('/servers/srv_kitchen/sessions/ses_1', '?directory=%2Fhome%2Fme%2Fapp')).toEqual(
      serverTarget,
    );
    expect(projectTargetFromRoute('/servers/srv_kitchen/sessions/ses_1', '')).toBeNull();
    expect(projectTargetFromRoute('/servers/srv_kitchen/projects', '')).toBeNull();
  });

  it('returns null outside project routes', () => {
    expect(projectTargetFromRoute('/', '')).toBeNull();
    expect(projectTargetFromRoute('/schedules', '')).toBeNull();
    expect(projectTargetFromRoute('/servers/srv_kitchen', '')).toBeNull();
  });
});

describe('getProjectHubPath', () => {
  it('builds the menu hub path for a repo', () => {
    expect(getProjectHubPath(repoTarget)).toBe('/?menu=sessions&menuProject=repo:7');
    expect(getProjectHubPath(assistantTarget)).toBe('/?menu=sessions&menuProject=repo:0');
  });

  it('opens the workspaces tab when requested', () => {
    expect(getProjectHubPath(repoTarget, { worktrees: true })).toBe(
      '/?menu=sessions&menuProject=repo:7&repoTab=workspaces',
    );
  });

  it('escapes a server target so the query reader recovers it', () => {
    expect(getProjectHubPath(serverTarget)).toBe(
      '/?menu=sessions&menuProject=server:srv_kitchen:%252Fhome%252Fme%252Fapp',
    );
    const path = getProjectHubPath(awkwardServerTarget);
    const params = new URLSearchParams(path.slice(path.indexOf('?') + 1));
    expect(parseProjectTarget(params.get('menuProject'))).toEqual(awkwardServerTarget);
  });
});
