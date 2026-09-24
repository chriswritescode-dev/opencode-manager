import type { V2Event } from '@opencode-manager/shared/opencode'

export const SESSION_ID = 'ses_1'
export const OTHER_SESSION_ID = 'ses_2'

export const eventID = (seq: number) => `evt_01J8Z00000000000000000${String(seq).padStart(3, '0')}`
export const messageID = (seq: number) => `msg_01J8Z00000000000000000${String(seq).padStart(3, '0')}`

export const USER_INBOX_ID = messageID(1)
export const ASSISTANT_MESSAGE_ID = messageID(2)
export const TOOL_ID = 'tool_1'
export const SHELL_ID = 'shell_1'

const durable = (seq: number) => ({ aggregateID: SESSION_ID, seq, version: 1 as const })

export const promptSequence: V2Event[] = [
  {
    id: eventID(1),
    created: 1000,
    type: 'session.inbox.enqueued',
    durable: durable(1),
    data: {
      sessionID: SESSION_ID,
      inboxID: USER_INBOX_ID,
      item: {
        type: 'user',
        payload: { text: 'Run the tests' },
        delivery: 'steer',
      },
    },
  },
  {
    id: eventID(2),
    created: 1010,
    type: 'session.inbox.delivered',
    durable: durable(2),
    data: { sessionID: SESSION_ID, inboxID: USER_INBOX_ID },
  },
  {
    id: eventID(3),
    created: 1020,
    type: 'session.step.started',
    durable: durable(3),
    data: {
      sessionID: SESSION_ID,
      assistantMessageID: ASSISTANT_MESSAGE_ID,
      agent: 'build',
      model: { id: 'claude-sonnet-4-5', providerID: 'anthropic' },
      started: 1020,
    },
  },
  {
    id: eventID(4),
    created: 1030,
    type: 'session.text.started',
    durable: durable(4),
    data: { sessionID: SESSION_ID, assistantMessageID: ASSISTANT_MESSAGE_ID, ordinal: 0 },
  },
  {
    id: eventID(5),
    created: 1031,
    type: 'session.text.delta',
    data: { sessionID: SESSION_ID, assistantMessageID: ASSISTANT_MESSAGE_ID, ordinal: 0, delta: 'Running the ' },
  },
  {
    id: eventID(6),
    created: 1032,
    type: 'session.text.delta',
    data: { sessionID: SESSION_ID, assistantMessageID: ASSISTANT_MESSAGE_ID, ordinal: 0, delta: 'tests' },
  },
  {
    id: eventID(7),
    created: 1040,
    type: 'session.text.ended',
    durable: durable(7),
    data: {
      sessionID: SESSION_ID,
      assistantMessageID: ASSISTANT_MESSAGE_ID,
      ordinal: 0,
      text: 'Running the tests now.',
    },
  },
  {
    id: eventID(8),
    created: 1050,
    type: 'session.reasoning.started',
    durable: durable(8),
    data: { sessionID: SESSION_ID, assistantMessageID: ASSISTANT_MESSAGE_ID, ordinal: 0 },
  },
  {
    id: eventID(9),
    created: 1051,
    type: 'session.reasoning.delta',
    data: { sessionID: SESSION_ID, assistantMessageID: ASSISTANT_MESSAGE_ID, ordinal: 0, delta: 'Checking ' },
  },
  {
    id: eventID(10),
    created: 1052,
    type: 'session.reasoning.delta',
    data: { sessionID: SESSION_ID, assistantMessageID: ASSISTANT_MESSAGE_ID, ordinal: 0, delta: 'the suite' },
  },
  {
    id: eventID(11),
    created: 1060,
    type: 'session.reasoning.ended',
    durable: durable(11),
    data: {
      sessionID: SESSION_ID,
      assistantMessageID: ASSISTANT_MESSAGE_ID,
      ordinal: 0,
      text: 'Checking the suite first.',
    },
  },
  {
    id: eventID(12),
    created: 1070,
    type: 'session.tool.input.started',
    durable: durable(12),
    data: { sessionID: SESSION_ID, assistantMessageID: ASSISTANT_MESSAGE_ID, id: TOOL_ID, name: 'shell' },
  },
  {
    id: eventID(13),
    created: 1071,
    type: 'session.tool.input.delta',
    data: { sessionID: SESSION_ID, assistantMessageID: ASSISTANT_MESSAGE_ID, id: TOOL_ID, delta: '{"command":' },
  },
  {
    id: eventID(14),
    created: 1072,
    type: 'session.tool.input.ended',
    durable: durable(14),
    data: {
      sessionID: SESSION_ID,
      assistantMessageID: ASSISTANT_MESSAGE_ID,
      id: TOOL_ID,
      text: '{"command":"bun test"}',
    },
  },
  {
    id: eventID(15),
    created: 1080,
    type: 'session.tool.called',
    durable: durable(15),
    data: {
      sessionID: SESSION_ID,
      assistantMessageID: ASSISTANT_MESSAGE_ID,
      id: TOOL_ID,
      input: { command: 'bun test' },
      executed: true,
    },
  },
  {
    id: eventID(16),
    created: 1085,
    type: 'session.tool.progress',
    data: {
      sessionID: SESSION_ID,
      assistantMessageID: ASSISTANT_MESSAGE_ID,
      id: TOOL_ID,
      metadata: { output: 'running' },
    },
  },
  {
    id: eventID(17),
    created: 1090,
    type: 'session.tool.success',
    durable: { aggregateID: SESSION_ID, seq: 17, version: 2 },
    data: {
      sessionID: SESSION_ID,
      assistantMessageID: ASSISTANT_MESSAGE_ID,
      id: TOOL_ID,
      content: [{ type: 'text', text: '12 tests passed' }],
      metadata: { exit: 0 },
      executed: true,
    },
  },
  {
    id: eventID(18),
    created: 1100,
    type: 'session.step.ended',
    durable: durable(18),
    data: {
      sessionID: SESSION_ID,
      assistantMessageID: ASSISTANT_MESSAGE_ID,
      finish: 'tool-calls',
      cost: 0.01,
      tokens: { input: 1200, output: 80, reasoning: 20, cache: { read: 0, write: 0 } },
    },
  },
]

export const textStreamSequence: V2Event[] = [
  {
    id: eventID(20),
    created: 2000,
    type: 'session.step.started',
    durable: durable(20),
    data: {
      sessionID: SESSION_ID,
      assistantMessageID: ASSISTANT_MESSAGE_ID,
      agent: 'build',
      model: { id: 'claude-sonnet-4-5', providerID: 'anthropic' },
      started: 2000,
    },
  },
  {
    id: eventID(21),
    created: 2010,
    type: 'session.text.started',
    durable: durable(21),
    data: { sessionID: SESSION_ID, assistantMessageID: ASSISTANT_MESSAGE_ID, ordinal: 0 },
  },
  {
    id: eventID(22),
    created: 2011,
    type: 'session.text.delta',
    data: { sessionID: SESSION_ID, assistantMessageID: ASSISTANT_MESSAGE_ID, ordinal: 0, delta: 'Hello ' },
  },
  {
    id: eventID(23),
    created: 2012,
    type: 'session.text.delta',
    data: { sessionID: SESSION_ID, assistantMessageID: ASSISTANT_MESSAGE_ID, ordinal: 0, delta: 'world' },
  },
  {
    id: eventID(24),
    created: 2020,
    type: 'session.text.ended',
    durable: durable(24),
    data: {
      sessionID: SESSION_ID,
      assistantMessageID: ASSISTANT_MESSAGE_ID,
      ordinal: 0,
      text: 'Hello world',
    },
  },
]

export const textGrowthSequence: V2Event[] = [
  {
    id: eventID(140),
    created: 14000,
    type: 'session.step.started',
    durable: durable(140),
    data: {
      sessionID: SESSION_ID,
      assistantMessageID: ASSISTANT_MESSAGE_ID,
      agent: 'build',
      model: { id: 'claude-sonnet-4-5', providerID: 'anthropic' },
      started: 14000,
    },
  },
  {
    id: eventID(141),
    created: 14010,
    type: 'session.text.started',
    durable: durable(141),
    data: { sessionID: SESSION_ID, assistantMessageID: ASSISTANT_MESSAGE_ID, ordinal: 0 },
  },
  {
    id: eventID(142),
    created: 14011,
    type: 'session.text.delta',
    data: { sessionID: SESSION_ID, assistantMessageID: ASSISTANT_MESSAGE_ID, ordinal: 0, delta: 'Hello ' },
  },
  {
    id: eventID(143),
    created: 14012,
    type: 'session.text.delta',
    data: { sessionID: SESSION_ID, assistantMessageID: ASSISTANT_MESSAGE_ID, ordinal: 0, delta: 'world' },
  },
  {
    id: eventID(144),
    created: 14013,
    type: 'session.text.delta',
    data: { sessionID: SESSION_ID, assistantMessageID: ASSISTANT_MESSAGE_ID, ordinal: 0, delta: '!' },
  },
  {
    id: eventID(145),
    created: 14014,
    type: 'session.text.delta',
    data: { sessionID: SESSION_ID, assistantMessageID: ASSISTANT_MESSAGE_ID, ordinal: 0, delta: '?' },
  },
]

export const failedToolSequence: V2Event[] = [
  {
    id: eventID(30),
    created: 3000,
    type: 'session.step.started',
    durable: durable(30),
    data: {
      sessionID: SESSION_ID,
      assistantMessageID: ASSISTANT_MESSAGE_ID,
      agent: 'build',
      model: { id: 'claude-sonnet-4-5', providerID: 'anthropic' },
      started: 3000,
    },
  },
  {
    id: eventID(31),
    created: 3010,
    type: 'session.tool.input.started',
    durable: durable(31),
    data: { sessionID: SESSION_ID, assistantMessageID: ASSISTANT_MESSAGE_ID, id: TOOL_ID, name: 'shell' },
  },
  {
    id: eventID(32),
    created: 3020,
    type: 'session.tool.called',
    durable: durable(32),
    data: {
      sessionID: SESSION_ID,
      assistantMessageID: ASSISTANT_MESSAGE_ID,
      id: TOOL_ID,
      input: { command: 'bun test' },
      executed: true,
    },
  },
  {
    id: eventID(33),
    created: 3030,
    type: 'session.tool.failed',
    durable: { aggregateID: SESSION_ID, seq: 33, version: 2 },
    data: {
      sessionID: SESSION_ID,
      assistantMessageID: ASSISTANT_MESSAGE_ID,
      id: TOOL_ID,
      error: { type: 'tool.failed', message: 'command exited 1' },
      metadata: { exit: 1 },
      executed: true,
    },
  },
]

export const shellSequence: V2Event[] = [
  {
    id: eventID(40),
    created: 4000,
    type: 'session.shell.started',
    durable: durable(40),
    data: {
      sessionID: SESSION_ID,
      shell: {
        id: SHELL_ID,
        command: 'bun test',
        status: 'running',
        cwd: '/repo',
        shell: '/bin/zsh',
        file: 'shell_1',
        metadata: {},
        time: { started: 4000 },
      },
    },
  },
  {
    id: eventID(41),
    created: 4050,
    type: 'session.shell.ended',
    durable: durable(41),
    data: {
      sessionID: SESSION_ID,
      shell: {
        id: SHELL_ID,
        command: 'bun test',
        status: 'exited',
        cwd: '/repo',
        shell: '/bin/zsh',
        file: 'shell_1',
        exit: 0,
        metadata: {},
        time: { started: 4000, completed: 4050 },
      },
      output: { output: '12 tests passed', cursor: 0, size: 16, truncated: false },
    },
  },
]

export const compactionSequence: V2Event[] = [
  {
    id: eventID(50),
    created: 5000,
    type: 'session.compaction.started',
    durable: durable(50),
    data: { sessionID: SESSION_ID, reason: 'auto', recent: 'previous turn' },
  },
  {
    id: eventID(51),
    created: 5010,
    type: 'session.compaction.delta',
    data: { sessionID: SESSION_ID, text: 'Summarizing' },
  },
  {
    id: eventID(52),
    created: 5020,
    type: 'session.compaction.ended',
    durable: durable(52),
    data: {
      sessionID: SESSION_ID,
      reason: 'auto',
      text: 'Summarizing the previous turn.',
      recent: 'previous turn',
      cost: 0.02,
      tokens: { input: 900, output: 60, reasoning: 0, cache: { read: 0, write: 0 } },
    },
  },
]

export const failedCompactionSequence: V2Event[] = [
  {
    id: eventID(53),
    created: 5030,
    type: 'session.compaction.started',
    durable: durable(53),
    data: { sessionID: SESSION_ID, reason: 'manual', recent: 'previous turn' },
  },
  {
    id: eventID(54),
    created: 5040,
    type: 'session.compaction.failed',
    durable: durable(54),
    data: {
      sessionID: SESSION_ID,
      reason: 'manual',
      error: { type: 'compaction.failed', message: 'provider unavailable' },
    },
  },
]

export const revertSequence: V2Event[] = [
  {
    id: eventID(60),
    created: 6000,
    type: 'session.step.started',
    durable: durable(60),
    data: {
      sessionID: SESSION_ID,
      assistantMessageID: ASSISTANT_MESSAGE_ID,
      agent: 'build',
      model: { id: 'claude-sonnet-4-5', providerID: 'anthropic' },
      started: 6000,
    },
  },
  {
    id: eventID(61),
    created: 6010,
    type: 'session.revert.staged',
    durable: durable(61),
    data: {
      sessionID: SESSION_ID,
      revert: { messageID: ASSISTANT_MESSAGE_ID, files: [] },
    },
  },
  {
    id: eventID(62),
    created: 6020,
    type: 'session.revert.cleared',
    durable: durable(62),
    data: { sessionID: SESSION_ID },
  },
]

export const revertCommitSequence: V2Event[] = [
  {
    id: eventID(70),
    created: 7000,
    type: 'session.inbox.enqueued',
    durable: durable(70),
    data: {
      sessionID: SESSION_ID,
      inboxID: USER_INBOX_ID,
      item: { type: 'user', payload: { text: 'Run the tests' }, delivery: 'steer' },
    },
  },
  {
    id: eventID(71),
    created: 7010,
    type: 'session.inbox.delivered',
    durable: durable(71),
    data: { sessionID: SESSION_ID, inboxID: USER_INBOX_ID },
  },
  {
    id: eventID(72),
    created: 7020,
    type: 'session.step.started',
    durable: durable(72),
    data: {
      sessionID: SESSION_ID,
      assistantMessageID: ASSISTANT_MESSAGE_ID,
      agent: 'build',
      model: { id: 'claude-sonnet-4-5', providerID: 'anthropic' },
      started: 7020,
    },
  },
  {
    id: eventID(73),
    created: 7030,
    type: 'session.revert.committed',
    durable: durable(73),
    data: { sessionID: SESSION_ID, to: ASSISTANT_MESSAGE_ID },
  },
]

export const statusSequence: V2Event[] = [
  {
    id: eventID(80),
    created: 8000,
    type: 'session.status',
    data: { sessionID: SESSION_ID, status: { type: 'busy' } },
  },
  {
    id: eventID(81),
    created: 8010,
    type: 'session.status',
    data: {
      sessionID: SESSION_ID,
      status: { type: 'retry', attempt: 2, message: 'rate limited', next: 8020 },
    },
  },
  {
    id: eventID(82),
    created: 8020,
    type: 'session.idle',
    data: { sessionID: SESSION_ID },
  },
]

export const executionSequence: V2Event[] = [
  {
    id: eventID(90),
    created: 9000,
    type: 'session.execution.started',
    durable: durable(90),
    data: { sessionID: SESSION_ID },
  },
  {
    id: eventID(91),
    created: 9010,
    type: 'session.execution.succeeded',
    durable: durable(91),
    data: { sessionID: SESSION_ID },
  },
]

export const queuedPromptSequence: V2Event[] = [
  {
    id: eventID(100),
    created: 10000,
    type: 'session.inbox.enqueued',
    durable: durable(100),
    data: {
      sessionID: SESSION_ID,
      inboxID: USER_INBOX_ID,
      item: { type: 'user', payload: { text: 'Wait for me' }, delivery: 'queue' },
    },
  },
  {
    id: eventID(101),
    created: 10010,
    type: 'session.inbox.delivery.changed',
    durable: durable(101),
    data: { sessionID: SESSION_ID, inboxID: USER_INBOX_ID, delivery: 'steer' },
  },
  {
    id: eventID(102),
    created: 10020,
    type: 'session.inbox.cancelled',
    durable: durable(102),
    data: { sessionID: SESSION_ID, inboxID: USER_INBOX_ID },
  },
]

export const instructionsSequence: V2Event[] = [
  {
    id: eventID(110),
    created: 11000,
    type: 'session.instructions.updated',
    durable: { aggregateID: SESSION_ID, seq: 110, version: 2 },
    data: { sessionID: SESSION_ID, delta: { 'AGENTS.md': 'hash-1' }, text: 'Instructions changed.' },
  },
]

export const syntheticSequence: V2Event[] = [
  {
    id: eventID(120),
    created: 12000,
    type: 'session.synthetic',
    durable: durable(120),
    data: { sessionID: SESSION_ID, text: 'Continue from the summary.', description: 'Synthetic' },
  },
]

export const otherSessionSequence: V2Event[] = [
  {
    id: eventID(130),
    created: 13000,
    type: 'session.inbox.enqueued',
    durable: { aggregateID: OTHER_SESSION_ID, seq: 130, version: 1 },
    data: {
      sessionID: OTHER_SESSION_ID,
      inboxID: 'msg_other',
      item: { type: 'user', payload: { text: 'Other session prompt' }, delivery: 'steer' },
    },
  },
  {
    id: eventID(131),
    created: 13010,
    type: 'session.status',
    data: { sessionID: OTHER_SESSION_ID, status: { type: 'busy' } },
  },
]
