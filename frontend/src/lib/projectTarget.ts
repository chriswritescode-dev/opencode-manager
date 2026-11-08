import { ASSISTANT_REPO_ID } from '@opencode-manager/shared/utils';
import { parseRepoRoute, parseServerProjectRoute, parseServerSessionRoute } from './navigation';

/**
 * Identifies a project shown by the side menu hub, either a Manager repo or a linked-server directory.
 */
export type ProjectTarget =
  | { kind: 'repo'; repoId: number }
  | { kind: 'server'; serverId: string; directory: string };

function decodeSegment(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

/**
 * Serialises a project target for the `menuProject` URL param.
 *
 * @param target Project to serialise.
 * @returns `repo:<id>` or `server:<serverId>:<directory>` with the server segments percent-encoded.
 */
export function encodeProjectTarget(target: ProjectTarget): string {
  if (target.kind === 'repo') {
    return `repo:${target.repoId}`;
  }
  return `server:${encodeURIComponent(target.serverId)}:${encodeURIComponent(target.directory)}`;
}

/**
 * Reads a `menuProject` URL param value.
 *
 * @param value Encoded target, as produced by {@link encodeProjectTarget}.
 * @returns The project target, or null when the value is missing or malformed.
 */
export function parseProjectTarget(value: string | null): ProjectTarget | null {
  if (!value) return null;

  const separator = value.indexOf(':');
  if (separator === -1) return null;

  const kind = value.slice(0, separator);
  const rest = value.slice(separator + 1);

  if (kind === 'repo') {
    return /^\d+$/.test(rest) ? { kind: 'repo', repoId: Number(rest) } : null;
  }

  if (kind === 'server') {
    const idSeparator = rest.indexOf(':');
    if (idSeparator === -1) return null;
    const serverId = decodeSegment(rest.slice(0, idSeparator));
    const directory = decodeSegment(rest.slice(idSeparator + 1));
    if (!serverId || !directory) return null;
    return { kind: 'server', serverId, directory };
  }

  return null;
}

/**
 * Compares two project targets.
 *
 * @param a First target, or null for no project.
 * @param b Second target, or null for no project.
 * @returns True when both describe the same project.
 */
export function isSameProjectTarget(a: ProjectTarget | null, b: ProjectTarget | null): boolean {
  if (a === null || b === null) return a === b;
  if (a.kind === 'repo') {
    return b.kind === 'repo' && a.repoId === b.repoId;
  }
  return b.kind === 'server' && a.serverId === b.serverId && a.directory === b.directory;
}

/**
 * Resolves the project a route points at.
 *
 * @param pathname Pathname of the route.
 * @param search Query string of the route.
 * @returns The route's project, or null when the route is not project-scoped.
 */
export function projectTargetFromRoute(pathname: string, search: string): ProjectTarget | null {
  if (pathname === '/assistant') {
    return { kind: 'repo', repoId: ASSISTANT_REPO_ID };
  }

  const repoRoute = parseRepoRoute(pathname);
  if (repoRoute.repoId !== null) {
    if (repoRoute.section === 'assistant') {
      return { kind: 'repo', repoId: ASSISTANT_REPO_ID };
    }
    const isAssistantSession = new URLSearchParams(search).get('assistant') === '1';
    if (repoRoute.sessionId && isAssistantSession) {
      return { kind: 'repo', repoId: ASSISTANT_REPO_ID };
    }
    return { kind: 'repo', repoId: repoRoute.repoId };
  }

  const serverProject = parseServerProjectRoute(pathname, search);
  if (serverProject) {
    return { kind: 'server', serverId: serverProject.serverId, directory: serverProject.directory };
  }

  const serverSession = parseServerSessionRoute(pathname);
  if (serverSession) {
    const directory = new URLSearchParams(search).get('directory');
    return directory
      ? { kind: 'server', serverId: serverSession.serverId, directory }
      : null;
  }

  return null;
}

/**
 * Builds the Home URL that opens the side menu on a project.
 *
 * @param target Project to show in the menu.
 * @param options When `worktrees` is set, the hub opens its workspaces tab.
 * @returns A `/?menu=sessions&menuProject=…` path.
 */
export function getProjectHubPath(target: ProjectTarget, options?: { worktrees?: boolean }): string {
  const encodedTarget = encodeProjectTarget(target).replaceAll('%', '%25');
  const worktrees = options?.worktrees ? '&repoTab=workspaces' : '';
  return `/?menu=sessions&menuProject=${encodedTarget}${worktrees}`;
}
