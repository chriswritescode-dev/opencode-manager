import { useState } from 'react'
import { SettingsDisclosure } from '@/components/settings/SettingsDisclosure'
import { SecretsManager } from './SecretsManager'

export function GlobalSecretsSettings() {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <SettingsDisclosure
      title="Secrets and variables"
      isOpen={isOpen}
      onToggle={() => setIsOpen((value) => !value)}
      contentClassName="space-y-3"
    >
      <SecretsManager scope={{ scope: 'global' }} />
    </SettingsDisclosure>
  )
}
