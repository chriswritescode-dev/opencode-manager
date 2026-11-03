import type {
  SessionMessageAssistantTool,
  SessionMessageInfo,
  V2Event,
} from '@opencode-manager/shared/opencode'
import type { ShellInfo } from '@/api/opencode'
import opencode221 from './repaired-bash/opencode-2.2.1.json'
import opencode225 from './repaired-bash/opencode-2.2.5.json'

export type RepairedBashVersion = '2.2.5' | '2.2.1'

export interface RepairedBashFixture {
  events: V2Event[]
  messages: SessionMessageInfo[]
  shells: ShellInfo[]
}

interface RecordedScenario {
  events: unknown[]
  messages: unknown[]
  shells: unknown[]
}

const fixtures: Record<
  RepairedBashVersion,
  { version: string; scenarios: Record<string, RecordedScenario> }
> = {
  '2.2.5': opencode225,
  '2.2.1': opencode221,
}

/**
 * Loads one recorded repaired-bash scenario from the version-pinned transcripts.
 *
 * @throws When the version recording has no scenario with that name.
 */
export function repairedBashFixture(
  version: RepairedBashVersion,
  scenario: string,
): RepairedBashFixture {
  const recorded = fixtures[version].scenarios[scenario]
  if (recorded === undefined) {
    throw new Error(`Unknown repaired bash scenario: ${version}/${scenario}`)
  }
  return {
    events: recorded.events as V2Event[],
    messages: recorded.messages as SessionMessageInfo[],
    shells: recorded.shells as ShellInfo[],
  }
}

/**
 * Finds the first assistant tool part with the given model-supplied tool name.
 *
 * @throws When no assistant message contains a tool part with that name.
 */
export function toolPart(messages: SessionMessageInfo[], name: string): SessionMessageAssistantTool {
  for (const message of messages) {
    if (message.type !== 'assistant') continue
    const part = message.content.find((entry) => entry.type === 'tool' && entry.name === name)
    if (part?.type === 'tool') return part
  }
  throw new Error(`No ${name} tool part found`)
}
