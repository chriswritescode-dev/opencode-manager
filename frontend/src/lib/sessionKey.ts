export function buildSessionKey(directory: string | undefined, id: string): string {
  return `${directory ?? ''}:${id}`
}

export function buildPinnedSessionKeys(
  pins: ReadonlyArray<{ directory: string; sessionId: string }>,
): Set<string> {
  return new Set(pins.map((pin) => buildSessionKey(pin.directory, pin.sessionId)))
}
