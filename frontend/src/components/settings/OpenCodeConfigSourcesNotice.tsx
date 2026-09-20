import { ChevronDown, Info } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { OPENCODE_CONFIG_SOURCE_NAMES } from '@opencode-manager/shared'
import {
  getOpenCodeConfigSources,
  getPreferredOpenCodeConfigSource,
} from '@/api/types/settings'
import type { OpenCodeConfigFile, OpenCodeConfigSourceName } from '@/api/types/settings'

interface OpenCodeConfigSourcesNoticeProps {
  config: OpenCodeConfigFile
  targetName?: OpenCodeConfigSourceName
}

export function OpenCodeConfigSourcesNotice({ config, targetName }: OpenCodeConfigSourcesNoticeProps) {
  const sources = getOpenCodeConfigSources(config)
  if (sources.length <= 1) return null

  const orderedNames = OPENCODE_CONFIG_SOURCE_NAMES.filter((name) =>
    sources.some((source) => source.name === name),
  )
  const writeTargetName = targetName ?? getPreferredOpenCodeConfigSource(config)?.name
  if (!writeTargetName) return null

  return (
    <Alert className="border-blue-500/30 bg-blue-500/5">
      <Info className="h-4 w-4 text-blue-500" />
      <details className="group" open>
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 [&::-webkit-details-marker]:hidden">
          <AlertTitle className="mb-0">Multiple configuration files are merged</AlertTitle>
          <ChevronDown className="h-4 w-4 shrink-0 text-blue-500 transition-transform group-open:rotate-180" />
        </summary>
        <AlertDescription>
          <p>
            OpenCode loads these files in order, with each later file overriding matching settings from the files before it:{' '}
            {orderedNames.map((name, index) => (
              <span key={name}>
                {index > 0 ? ', ' : ''}
                <code className="font-mono text-foreground">{name}</code>
              </span>
            ))}
          </p>
          <p className="mt-1">
            Saves apply only to <code className="font-mono text-foreground">{writeTargetName}</code>. A value saved to a lower-priority file can be overridden by a higher-priority file.
          </p>
          <p className="mt-1">
            For simpler configuration, consolidate the settings you need into one file, then remove redundant files after verifying the result.
          </p>
        </AlertDescription>
      </details>
    </Alert>
  )
}
