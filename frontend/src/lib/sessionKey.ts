export function buildSessionKey(directory: string | undefined, id: string): string {
  return `${directory ?? ''}:${id}`
}
