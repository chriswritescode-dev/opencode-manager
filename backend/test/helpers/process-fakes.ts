import { z } from 'zod'
import { type CommandExecutor, type ExecuteCommandOptions, type ExecuteCommandResult } from '../../src/utils/process'

export interface FakeCommandCall {
  args: string[]
  options?: ExecuteCommandOptions
}

export interface FakeCommandResult {
  exitCode?: number
  stdout?: string
  stderr?: string
  error?: Error
}

export interface FakeCommandExecutor {
  execute: CommandExecutor
  calls: FakeCommandCall[]
}

const CommandOptionsSchema = z.object({
  cwd: z.string().optional(),
  silent: z.boolean().optional(),
  env: z.record(z.string(), z.string()).optional(),
  ignoreExitCode: z.boolean().optional(),
  timeout: z.number().optional(),
  maxOutputChars: z.number().optional(),
})

export function createFakeCommandExecutor(
  handler: (args: string[], options: ExecuteCommandOptions) => FakeCommandResult | Promise<FakeCommandResult>,
): FakeCommandExecutor {
  const calls: FakeCommandCall[] = []

  function execute(args: string[], options: ExecuteCommandOptions & { ignoreExitCode: true }): Promise<ExecuteCommandResult>
  function execute(args: string[], cwdOrOptions?: string | ExecuteCommandOptions): Promise<string>
  async function execute(args: string[], cwdOrOptions?: string | ExecuteCommandOptions): Promise<string | ExecuteCommandResult> {
    const parsedCwd = z.string().safeParse(cwdOrOptions)
    const parsedOptions = CommandOptionsSchema.safeParse(cwdOrOptions)
    const options: ExecuteCommandOptions = parsedCwd.success
      ? { cwd: parsedCwd.data }
      : parsedOptions.success ? parsedOptions.data : {}
    calls.push({ args, options })

    const result = await handler(args, options)
    if (result.error) throw result.error

    const resolved: ExecuteCommandResult = {
      exitCode: result.exitCode ?? 0,
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
    }
    if (options.ignoreExitCode) return resolved
    if (resolved.exitCode !== 0) {
      throw new Error(`Command failed with code ${resolved.exitCode}: ${args.join(' ')}`)
    }
    return resolved.stdout
  }

  return { execute, calls }
}
