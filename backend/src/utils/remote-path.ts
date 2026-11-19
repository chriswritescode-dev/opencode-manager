export function isAbsoluteRemoteDirectory(directory: string): boolean {
  return directory.startsWith('/') || /^[A-Za-z]:[\\/]/.test(directory)
}
