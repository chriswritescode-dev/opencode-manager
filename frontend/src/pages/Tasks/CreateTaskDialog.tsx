import { useState, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useToast } from '@/components/ui/use-toast'

interface CreateTaskDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}

interface Skill {
  name: string
  description: string
}

export function CreateTaskDialog({ open, onOpenChange, onSuccess }: CreateTaskDialogProps) {
  const [name, setName] = useState('')
  const [schedule, setSchedule] = useState('0 9 * * *')
  const [type, setType] = useState<'skill' | 'script'>('skill')
  const [skillName, setSkillName] = useState('')
  const [scriptCommand, setScriptCommand] = useState('')
  const [availableSkills, setAvailableSkills] = useState<Skill[]>([])
  const [loading, setLoading] = useState(false)
  const { toast } = useToast()

  // Fetch available skills (assuming an endpoint exists, or we mock it for now)
  useEffect(() => {
    // TODO: Implement /api/skills endpoint in backend or opencode-proxy
    // For MVP, we'll just allow text input or hardcode common ones
    setAvailableSkills([
        { name: 'recruiter-response', description: 'Reply to recruiters' },
        { name: 'daily-summary', description: 'Summarize tasks' }
    ])
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)

    try {
      const commandConfig = type === 'skill' 
        ? { skillName } 
        : { command: scriptCommand }

      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          schedule_type: 'cron',
          schedule_value: schedule,
          command_type: type,
          command_config: commandConfig,
        }),
      })

      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Failed to create task')
      }

      toast({ title: 'Task created successfully' })
      onSuccess()
      setName('')
      setSchedule('0 9 * * *')
      setSkillName('')
      setScriptCommand('')
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Create Scheduled Task</DialogTitle>
          <DialogDescription>
            Add a new automated task to your schedule.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="grid gap-4 py-4">
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="name" className="text-right">
              Name
            </Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Morning Routine"
              className="col-span-3"
              required
            />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="schedule" className="text-right">
              Cron
            </Label>
            <Input
              id="schedule"
              value={schedule}
              onChange={(e) => setSchedule(e.target.value)}
              placeholder="0 9 * * *"
              className="col-span-3 font-mono"
              required
            />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="type" className="text-right">
              Type
            </Label>
            <Select value={type} onValueChange={(v: 'skill' | 'script') => setType(v)}>
              <SelectTrigger className="col-span-3">
                <SelectValue placeholder="Select type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="skill">Opencode Skill</SelectItem>
                <SelectItem value="script">Shell Script</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {type === 'skill' ? (
             <div className="grid grid-cols-4 items-center gap-4">
             <Label htmlFor="skill" className="text-right">
               Skill
             </Label>
             <Select value={skillName} onValueChange={setSkillName}>
                <SelectTrigger className="col-span-3">
                    <SelectValue placeholder="Select a skill" />
                </SelectTrigger>
                <SelectContent>
                    {availableSkills.map(s => (
                        <SelectItem key={s.name} value={s.name}>{s.name}</SelectItem>
                    ))}
                    <SelectItem value="custom">Custom (Type below)</SelectItem>
                </SelectContent>
             </Select>
             {skillName === 'custom' && (
                 <Input 
                    placeholder="Skill Name" 
                    className="col-span-3 col-start-2 mt-2" 
                    onChange={e => setSkillName(e.target.value)}
                 />
             )}
           </div>
          ) : (
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="command" className="text-right">
                Command
              </Label>
              <Input
                id="command"
                value={scriptCommand}
                onChange={(e) => setScriptCommand(e.target.value)}
                placeholder="./scripts/my-script.sh"
                className="col-span-3 font-mono"
                required
              />
            </div>
          )}
        </form>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" onClick={handleSubmit} disabled={loading}>
            {loading ? 'Creating...' : 'Create Task'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
