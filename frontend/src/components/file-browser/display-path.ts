export function getRepoRelativeDisplayPath(currentPath: string, basePath: string): string {
  const baseParts = basePath === '.' ? [] : basePath.split('/').filter(Boolean)
  const pathParts = currentPath === '.' ? [] : currentPath.split('/').filter(Boolean)
  const isWithinBase = baseParts.every((part, index) => pathParts[index] === part)
  const subParts = isWithinBase ? pathParts.slice(baseParts.length) : pathParts
  return subParts.length > 0 ? '/' + subParts.join('/') : '/'
}
