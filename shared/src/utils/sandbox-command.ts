const SANDBOX_EXEC_WRAPPER_PATTERN = /^'(?:[^']|'\\'')*' exec [A-Za-z0-9_-]+ --no-tty -q -u '(?:[^']|'\\'')*' -w '(?:[^']|'\\'')*' --timeout \d+s -- sh -c '((?:[^']|'\\'')*)'$/
const SINGLE_QUOTE_ESCAPE_PATTERN = /'\\''/g

export function unwrapSandboxExecCommand(command: string): string {
  const match = SANDBOX_EXEC_WRAPPER_PATTERN.exec(command)
  if (match === null) return command
  return match[1]!.replace(SINGLE_QUOTE_ESCAPE_PATTERN, "'")
}
