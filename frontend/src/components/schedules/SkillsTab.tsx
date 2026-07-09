import { useTranslation } from 'react-i18next'
import { Label } from '@/components/ui/label'
import { TabsContent } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { MultiSelect } from '@/components/ui/multi-select'
import { Loader2, Sparkles } from 'lucide-react'

type SkillsTabProps = {
  skillSlugs: string[]
  onSkillSlugsChange: (value: string[]) => void
  skillNotes: string
  onSkillNotesChange: (value: string) => void
  skills: Array<{ name: string; description: string }>
  skillsLoading: boolean
}

export function SkillsTab({
  skillSlugs,
  onSkillSlugsChange,
  skillNotes,
  onSkillNotesChange,
  skills,
  skillsLoading,
}: SkillsTabProps) {
  const { t } = useTranslation()

  return (
    <TabsContent value="skills" className="mt-0 min-h-0 flex-1 overflow-y-auto px-6 pt-4 pb-5">
      <div className="space-y-4">
        <div className="space-y-2">
          <Label>{t('schedule.selectSkills')}</Label>
          <p className="text-xs text-muted-foreground">
            {t('schedule.selectSkillsHint')}
          </p>
        </div>

        {skillsLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : skills.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border bg-card/50 p-6 text-center">
            <Sparkles className="h-6 w-6 mx-auto mb-2 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">{t('schedule.noSkillsHint')}</p>
          </div>
        ) : (
          <MultiSelect
            value={skillSlugs}
            onChange={onSkillSlugsChange}
            options={skills.map(s => ({ value: s.name, label: s.name, description: s.description }))}
            placeholder={t('schedule.searchSkills')}
          />
        )}

        <div className="space-y-2">
          <Label htmlFor="schedule-skill-notes">{t('schedule.notes')}</Label>
          <Textarea
            id="schedule-skill-notes"
            value={skillNotes}
            onChange={(event) => onSkillNotesChange(event.target.value)}
            placeholder={t('schedule.skillNotesPlaceholder')}
            className="min-h-[80px]"
          />
        </div>
      </div>
    </TabsContent>
  )
}
