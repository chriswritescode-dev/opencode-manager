import { useTranslation } from 'react-i18next'
import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { SettingsList, SettingsListRow } from '@/components/ui/settings-list'
import type { SkillFileInfo, SkillScope } from '@opencode-manager/shared'

type SkillFilter = 'all' | SkillScope

interface SkillLibraryAction {
  label: string
  onClick: (skill: SkillFileInfo) => void
  destructive?: boolean
}

interface SkillLibraryListProps {
  isLoading: boolean
  data: SkillFileInfo[] | undefined
  error: Error | null
  primaryAction?: {
    label: string
    onClick: (skill: SkillFileInfo) => void
  }
  rowActions?: SkillLibraryAction[]
  emptyTitle?: string
  emptyHint?: string
  maxHeightClassName?: string
}

const getSkillKey = (skill: SkillFileInfo) => `${skill.scope}-${skill.repoId ?? 'global'}-${skill.name}`

const getScopeLabel = (skill: SkillFileInfo) => {
  if (skill.scope === 'global') return 'Global'
  return skill.repoName ? `Project: ${skill.repoName}` : 'Project'
}

const getCompactScopeLabel = (skill: SkillFileInfo) => skill.scope === 'global' ? 'Global' : 'Project'

const matchesSkillSearch = (skill: SkillFileInfo, search: string) => {
  const query = search.trim().toLowerCase()
  if (!query) return true
  return [skill.name, skill.description, skill.location, skill.repoName]
    .filter(Boolean)
    .some((value) => value?.toLowerCase().includes(query))
}

export function SkillLibraryList({
  isLoading,
  data,
  error,
  primaryAction,
  rowActions = [],
  emptyTitle,
  emptyHint,
  maxHeightClassName = 'max-h-[420px]',
}: SkillLibraryListProps) {
  const { t } = useTranslation()
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<SkillFilter>('all')

  const counts = useMemo(() => {
    const skills = data ?? []
    return {
      all: skills.length,
      project: skills.filter((skill) => skill.scope === 'project').length,
      global: skills.filter((skill) => skill.scope === 'global').length,
    }
  }, [data])

  const filteredSkills = useMemo(() => {
    return (data ?? [])
      .filter((skill) => filter === 'all' || skill.scope === filter)
      .filter((skill) => matchesSkillSearch(skill, search))
  }, [data, filter, search])

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t('settings.searchSkills')}
            className="pl-9"
          />
        </div>
        <div className="flex items-center gap-1 rounded-lg border border-border bg-muted/30 p-1">
          {(['all', 'project', 'global'] as const).map((key) => (
            <Button key={key} type="button" variant={filter === key ? 'secondary' : 'ghost'} size="sm" onClick={() => setFilter(key)}>
              <span>{t(`skillLibrary.${key}`)}</span>
              {counts[key] > 0 && <span className="ml-1">{counts[key]}</span>}
            </Button>
          ))}
        </div>
      </div>

      <SettingsList
        isLoading={isLoading}
        error={error}
        isEmpty={filteredSkills.length === 0}
        emptyTitle={emptyTitle ?? t('skillLibrary.noSkills')}
        emptyHint={emptyHint ?? t('skillLibrary.noSkillsHint')}
        errorTitle={t('skillLibrary.loadError')}
        maxHeightClassName={maxHeightClassName}
      >
        {filteredSkills.map((skill) => (
          <SettingsListRow
            key={getSkillKey(skill)}
            title={skill.name}
            titleClassName="text-orange-600 dark:text-orange-400"
            description={skill.description}
            onClick={primaryAction ? () => primaryAction.onClick(skill) : undefined}
            primaryAction={primaryAction ? { label: primaryAction.label, onClick: () => primaryAction.onClick(skill) } : undefined}
            actions={rowActions.map((a) => ({ label: a.label, destructive: a.destructive, onClick: () => a.onClick(skill) }))}
            actionsLabel={t('skillLibrary.actionsFor', { name: skill.name })}
            badges={
              <>
                <Badge variant={skill.scope === 'global' ? 'secondary' : 'outline'} className="shrink-0 sm:hidden">
                  {getCompactScopeLabel(skill)}
                </Badge>
                <Badge variant={skill.scope === 'global' ? 'secondary' : 'outline'} className="hidden max-w-full truncate sm:inline-flex">
                  {getScopeLabel(skill)}
                </Badge>
              </>
            }
          />
        ))}
      </SettingsList>
    </div>
  )
}
