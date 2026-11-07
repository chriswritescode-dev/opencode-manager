import { z } from 'zod'
import { OutputDefinitionSchema, type OutputDefinition } from './outputs'
import { ChangeHunkSchema } from './change-sources'

export const WalkthroughOutputDataSchema = z.object({
  title: z.string().max(200),
  summary: z.string().max(8000),
  stops: z.array(
    z.object({
      id: z.string().max(64),
      title: z.string().max(200),
      explanation: z.string().max(8000),
      hunks: z.array(ChangeHunkSchema),
    }),
  ),
  otherHunks: z.array(ChangeHunkSchema),
  risks: z.array(z.string().max(2000)).optional(),
  testing: z.string().max(8000).optional(),
})

export type WalkthroughOutputData = z.infer<typeof WalkthroughOutputDataSchema>

const WALKTHROUGH_OUTPUT_INSTRUCTIONS = `You are building an interactive walkthrough of the changes in this session.

## Getting the changes
- Call the \`read_output_input\` tool to get the outline of the changed files and their hunks.
- Call \`read_output_input\` with \`{ "file": "<path>" }\` to get one changed file's full hunks.
- Read surrounding code with the file tools when you need context, but never edit repository files.

## Reading order
- Order the stops by what best explains the change: contracts and data model first, then core logic, then callers and UI, then tests and config.
- Group related hunks, possibly across files, and explain intent and impact rather than restating the code.
- Reference hunks only by id. Never retype diff lines.

## Publishing
- Call \`publish_output\` with the data as soon as a first version is usable, and publish again after significant revisions.
- Keep all explanation text in Markdown.`

export const WALKTHROUGH_OUTPUT_DEFINITION: OutputDefinition = OutputDefinitionSchema.parse({
  id: 'walkthrough',
  label: 'Walkthrough',
  description: 'An interactive walkthrough of the changes in this session.',
  icon: 'BookOpen',
  origin: 'builtin',
  params: [{ type: 'changeSource', name: 'source', label: 'Changes' }],
  provider: 'changes',
  instructions: WALKTHROUGH_OUTPUT_INSTRUCTIONS,
  dataSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['title', 'summary', 'stops'],
    properties: {
      title: { type: 'string', maxLength: 200 },
      summary: { type: 'string', maxLength: 8000 },
      stops: {
        type: 'array',
        maxItems: 60,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'title', 'explanation', 'hunkIds'],
          properties: {
            id: { type: 'string', maxLength: 64 },
            title: { type: 'string', maxLength: 200 },
            explanation: { type: 'string', maxLength: 8000 },
            hunkIds: { type: 'array', maxItems: 200, items: { type: 'string', maxLength: 64 } },
          },
        },
      },
      risks: { type: 'array', maxItems: 30, items: { type: 'string', maxLength: 2000 } },
      testing: { type: 'string', maxLength: 8000 },
    },
  },
  generation: 'separateSession',
  renderer: { kind: 'builtin', id: 'walkthrough' },
})

export const BUILTIN_OUTPUT_DEFINITIONS = [WALKTHROUGH_OUTPUT_DEFINITION]

export const DEFAULT_OUTPUT_DEFINITION_ID = WALKTHROUGH_OUTPUT_DEFINITION.id

export function isBuiltinOutputDefinitionId(id: string): boolean {
  return BUILTIN_OUTPUT_DEFINITIONS.some((definition) => definition.id === id)
}
