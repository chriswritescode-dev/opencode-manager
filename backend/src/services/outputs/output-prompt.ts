import path from 'node:path'
import {
  buildSchedulePermissionRuleset,
  type OutputDefinition,
  type OutputParams,
  type SchedulePermissionRuleset,
} from '@opencode-manager/shared/schemas'

export function buildOutputSessionPrompt(input: {
  definition: OutputDefinition
  title: string
  params: OutputParams
  outputDir: string
}): string {
  const { definition, title, outputDir } = input
  const sections: string[] = [
    `Building the "${definition.label}" output for "${title}".`,
    definition.instructions,
  ]

  if (definition.provider !== undefined) {
    sections.push([
      '## Input',
      '- Call the `ocm` tool with the `read_output_input` action to get an outline of the input.',
      '- Call `read_output_input` again with `{ "file": "<path>" }` to get one changed file\'s full content.',
      '- Read surrounding code with the file tools when you need context, but never edit repository files.',
    ].join('\n'))
  }

  if (definition.renderer.kind === 'html') {
    sections.push([
      '## Output',
      `- Write one self-contained HTML file at exactly \`${outputDir}/index.html\` with the file write/edit tools, not the shell.`,
      '- Inline all CSS and JavaScript. Load third-party libraries only from public CDNs. Do not write sibling files.',
      '- Do not use forms, popups, cookies or local storage.',
      `- Call the \`ocm\` tool with the \`publish_output\` action with \`{ "path": "${outputDir}/index.html" }\`.`,
    ].join('\n'))
  } else {
    sections.push([
      '## Output',
      `- The output directory is \`${outputDir}\`.`,
      '- Call the `ocm` tool with the `publish_output` action with `{ "data": ... }` matching this JSON schema:',
      `\`\`\`json\n${JSON.stringify(definition.dataSchema, null, 2)}\n\`\`\``,
    ].join('\n'))
  }

  sections.push([
    '## Publishing',
    '- Call the `ocm` tool with the `publish_output` action as soon as a first version is usable, and again after significant revisions.',
    '- End with a one-paragraph summary reply.',
  ].join('\n'))

  return sections.join('\n\n')
}

export function buildOutputSessionPermissions(outputDir: string): SchedulePermissionRuleset {
  const normalized = path.resolve(outputDir).replaceAll('\\', '/')
  const ruleset = buildSchedulePermissionRuleset(null)
  ruleset.push({ action: 'edit', resource: '*', effect: 'deny' })
  ruleset.push({ action: 'external_directory', resource: `${normalized}/*`, effect: 'allow' })
  ruleset.push({ action: 'edit', resource: `${normalized}/*`, effect: 'allow' })
  return ruleset
}
