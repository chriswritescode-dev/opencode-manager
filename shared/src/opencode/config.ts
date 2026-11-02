import type { ConfigEntry } from '@opencode/client'

export type OpenCodeConfigInfo = Extract<ConfigEntry, { type: 'document' }>['info']

export type OpenCodeAgentConfig = NonNullable<OpenCodeConfigInfo['agents']>[string]

export type OpenCodeCommandConfig = NonNullable<OpenCodeConfigInfo['commands']>[string]

export type OpenCodeProviderConfig = NonNullable<OpenCodeConfigInfo['providers']>[string]

export type OpenCodeProviderModelConfig = NonNullable<OpenCodeProviderConfig['models']>[string]

export type OpenCodePermissionRule = NonNullable<OpenCodeConfigInfo['permissions']>[number]
