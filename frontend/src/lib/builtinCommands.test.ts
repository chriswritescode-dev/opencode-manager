import { describe, expect, it } from 'vitest'
import { getBuiltinCommands } from './builtinCommands'

function commandNames(isLocalServer: boolean, isChat = false): string[] {
  return getBuiltinCommands(isLocalServer, isChat).map((command) => command.name)
}

describe('getBuiltinCommands', () => {
  it('offers every built-in command for the local server outside chats', () => {
    const names = commandNames(true)

    expect(names).toContain('mcp')
    expect(names).toContain('skills')
    expect(names).toContain('walkthrough')
    expect(names).toContain('undo')
    expect(names).toContain('sessions')
  })

  it('omits mcp, skills, and walkthrough for chat sessions and keeps the rest', () => {
    const names = commandNames(true, true)

    expect(names).not.toContain('mcp')
    expect(names).not.toContain('skills')
    expect(names).not.toContain('walkthrough')
    expect(names).toContain('sessions')
    expect(names).toContain('models')
    expect(names).toContain('compact')
    expect(names).toContain('undo')
    expect(names).toContain('settings')
  })

  it('keeps mcp and skills but omits walkthrough for a linked server outside chats', () => {
    const names = commandNames(false)

    expect(names).toContain('mcp')
    expect(names).toContain('skills')
    expect(names).not.toContain('walkthrough')
  })

  it('omits mcp, skills, and walkthrough for a linked server in a chat session', () => {
    const names = commandNames(false, true)

    expect(names).not.toContain('mcp')
    expect(names).not.toContain('skills')
    expect(names).not.toContain('walkthrough')
    expect(names).toContain('models')
  })
})
