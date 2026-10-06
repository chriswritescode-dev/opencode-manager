import {
  isSessionNotFoundError,
  type FileDiffInfo,
  type SessionInfo,
} from '@opencode-manager/shared/opencode'
import {
  FUSION_PROMPT_MAX_LENGTH,
  type FusionUnavailableSource,
  type MultiRunFusionSource,
} from '@opencode-manager/shared/schemas'
import type { MultiRunEntryRecord } from '../db/multi-runs'
import { getErrorMessage } from '../utils/error-utils'
import { ServiceError } from '../utils/service-error'
import { truncateText } from '../utils/text-truncate'
import type { OpenCodeClient } from './opencode/client'
import { readSessionChanges } from './session-changes'
import {
  SESSION_REPLY_TRUNCATION_MARKER,
  isSessionBusyIn,
  readLatestAssistantReply,
  type ActiveSessions,
} from './session-reply'

export interface CollectedFusionSource {
  entryId: number
  model: string
  sessionId: string
  directory: string | null
  outcome: 'succeeded' | 'failed' | 'interrupted' | null
  replyText: string
  changes: FileDiffInfo[] | null
}

export interface FusionSourceCollection {
  ready: CollectedFusionSource[]
  unavailable: FusionUnavailableSource[]
}

export const FUSION_MIN_SOURCE_CONTEXT = 1500

const FUSION_REPLY_BUDGET_RATIO = 0.4

const FUSION_BLOCK_SEPARATOR = '\n\n'

export class FusionContextLimitError extends ServiceError {
  constructor(requiredPerSource: number, availablePerSource: number) {
    super(
      'The selected results are too large to fuse. Select fewer sources or shorten the instructions.',
      413,
      { code: 'FUSION_CONTEXT_LIMIT', details: { requiredPerSource, availablePerSource } },
    )
    this.name = 'FusionContextLimitError'
  }
}

export interface FusionPromptInput {
  runName: string
  objective: string
  instructions?: string
  sources: CollectedFusionSource[]
}

export interface FusionPrompt {
  prompt: string
  sources: MultiRunFusionSource[]
}

export function buildFusionPrompt({ runName, objective, instructions, sources }: FusionPromptInput): FusionPrompt {
  const preamble = buildFusionPreamble({ runName, objective, instructions })

  if (sources.length === 0) {
    return { prompt: preamble, sources: [] }
  }

  const scaffolds = sources.map((source, index) => buildFusionSourceBlock(source, index, '', source.changes === null ? null : ''))
  const fixed = preamble.length
    + scaffolds.reduce((total, scaffold) => total + scaffold.length, 0)
    + FUSION_BLOCK_SEPARATOR.length * sources.length

  const perSource = Math.floor((FUSION_PROMPT_MAX_LENGTH - fixed) / sources.length)
  if (perSource < FUSION_MIN_SOURCE_CONTEXT) {
    throw new FusionContextLimitError(FUSION_MIN_SOURCE_CONTEXT, perSource)
  }

  const markerLength = SESSION_REPLY_TRUNCATION_MARKER.length
  const replySlot = Math.floor(perSource * FUSION_REPLY_BUDGET_RATIO)
  const replyBudget = Math.max(replySlot - markerLength, 0)
  const patchBudget = Math.max(perSource - replySlot - markerLength, 0)

  const attributed: MultiRunFusionSource[] = []
  const blocks = sources.map((source, index) => {
    const reply = truncateText(source.replyText, replyBudget, SESSION_REPLY_TRUNCATION_MARKER)
    const changes = source.changes === null
      ? null
      : truncateText(renderFusionPatchText(source.changes), patchBudget, SESSION_REPLY_TRUNCATION_MARKER)

    attributed.push({
      entryId: source.entryId,
      sessionId: source.sessionId,
      model: source.model,
      truncated: reply.truncated || Boolean(changes?.truncated),
    })

    return buildFusionSourceBlock(source, index, reply.text, changes ? changes.text : null)
  })

  return { prompt: [preamble, ...blocks].join(FUSION_BLOCK_SEPARATOR), sources: attributed }
}

function buildFusionPreamble({ runName, objective, instructions }: { runName: string; objective: string; instructions?: string }): string {
  const trimmedInstructions = instructions?.trim()

  return [
    `You are synthesizing the results of the multi-run "${runName}" into a single implementation in the current workspace.`,
    '## Original objective',
    objective,
    ...(trimmedInstructions ? ['## Additional instructions', trimmedInstructions] : []),
    '## Rules',
    [
      '- The source sessions and workspaces below are read-only references. Do not modify, merge or push them.',
      '- Apply any adopted changes only in the current workspace.',
      '- Attribute each adopted part of the synthesis to the source it came from.',
    ].join('\n'),
  ].join(FUSION_BLOCK_SEPARATOR)
}

function buildFusionSourceBlock(
  source: CollectedFusionSource,
  index: number,
  replyBody: string,
  patchBody: string | null,
): string {
  return [
    `## Source ${index + 1} — ${source.model}`,
    '',
    `- Session: ${source.sessionId}`,
    `- Outcome: ${source.outcome ?? 'unknown'}`,
    `- Workspace: ${source.directory ?? 'not recorded'}`,
    '',
    'Changed files:',
    ...renderFusionChangedFiles(source.changes),
    '',
    '### Final reply',
    '',
    replyBody,
    '',
    '### Changes',
    '',
    ...(patchBody === null ? ['Changes could not be read.'] : ['```diff', patchBody, '```']),
  ].join('\n')
}

function renderFusionChangedFiles(changes: FileDiffInfo[] | null): string[] {
  if (changes === null) {
    return ['- (changes could not be read)']
  }
  if (changes.length === 0) {
    return ['- (no files changed)']
  }
  return changes.map((change) => `- ${change.file} (${change.status}, +${change.additions}/-${change.deletions})`)
}

function renderFusionPatchText(changes: FileDiffInfo[]): string {
  return changes.map((change) => change.patch).join('\n')
}

type FusionSourceResult =
  | { kind: 'ready'; source: CollectedFusionSource }
  | { kind: 'unavailable'; source: FusionUnavailableSource }

export async function collectFusionSources(
  client: OpenCodeClient,
  entries: MultiRunEntryRecord[],
): Promise<FusionSourceCollection> {
  let activeSessions: Promise<ActiveSessions> | null = null
  const getActiveSessions = (): Promise<ActiveSessions> => {
    activeSessions ??= client.api.session.active()
    return activeSessions
  }

  const results = await Promise.all(entries.map((entry) => collectFusionSource(client, entry, getActiveSessions)))

  const ready: CollectedFusionSource[] = []
  const unavailable: FusionUnavailableSource[] = []

  for (const result of results) {
    if (result.kind === 'ready') {
      ready.push(result.source)
    } else {
      unavailable.push(result.source)
    }
  }

  return { ready, unavailable }
}

async function collectFusionSource(
  client: OpenCodeClient,
  entry: MultiRunEntryRecord,
  getActiveSessions: () => Promise<ActiveSessions>,
): Promise<FusionSourceResult> {
  if (entry.status !== 'started' || !entry.sessionId) {
    return unavailable(entry, 'not-started', 'The result has not started a session.')
  }

  const sessionId = entry.sessionId

  let session: SessionInfo
  try {
    session = await client.api.session.get({ sessionID: sessionId })
  } catch (error) {
    if (isSessionNotFoundError(error)) {
      return unavailable(entry, 'missing', 'The session no longer exists.')
    }
    return unavailable(entry, 'unavailable', getErrorMessage(error))
  }

  try {
    if (isSessionBusyIn(await getActiveSessions(), sessionId)) {
      return unavailable(entry, 'running', 'The session is still running.')
    }

    const reply = await readLatestAssistantReply(client, sessionId)
    if (!reply || !reply.completed) {
      return unavailable(entry, 'incomplete', 'The session has not produced a final reply.')
    }

    if (session.outcome === 'failed' || session.outcome === 'interrupted' || reply.errorText) {
      return unavailable(entry, 'failed', failureMessage(session, reply.errorText))
    }

    const changes = await readSessionChanges(client, sessionId).catch(() => null)

    return {
      kind: 'ready',
      source: {
        entryId: entry.id,
        model: entry.model,
        sessionId,
        directory: entry.directory,
        outcome: session.outcome ?? null,
        replyText: reply.responseText ?? '',
        changes,
      },
    }
  } catch (error) {
    return unavailable(entry, 'unavailable', getErrorMessage(error))
  }
}

function failureMessage(session: SessionInfo, errorText: string | null): string {
  if (errorText) {
    return `The session failed: ${errorText}`
  }

  return session.outcome === 'interrupted'
    ? 'The session was interrupted.'
    : 'The session did not complete successfully.'
}

function unavailable(
  entry: MultiRunEntryRecord,
  reason: FusionUnavailableSource['reason'],
  message: string,
): FusionSourceResult {
  return { kind: 'unavailable', source: { entryId: entry.id, model: entry.model, reason, message } }
}
