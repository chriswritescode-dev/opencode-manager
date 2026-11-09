import { Navigate, useLocation } from 'react-router-dom'
import { getProjectHubPath, projectTargetFromRoute } from '@/lib/projectTarget'

/**
 * Sends legacy project and assistant routes into the Home side menu.
 *
 * @returns A redirect to the Home hub for the route's project, or to Home when the route has no project.
 */
export function ProjectHubRedirect() {
  const location = useLocation()
  const target = projectTargetFromRoute(location.pathname, location.search)
  const repoTab = new URLSearchParams(location.search).get('repoTab')

  if (!target) {
    return <Navigate to="/" replace />
  }

  return <Navigate to={getProjectHubPath(target, { worktrees: repoTab === 'workspaces' })} replace />
}
