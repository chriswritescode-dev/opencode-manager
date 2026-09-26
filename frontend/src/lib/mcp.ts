export function formatMcpServerName(serverId: string): string {
  const name = serverId.replace(/[-_]/g, ' ')
  return name.charAt(0).toUpperCase() + name.slice(1)
}
