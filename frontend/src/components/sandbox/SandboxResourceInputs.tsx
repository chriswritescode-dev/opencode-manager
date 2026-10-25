import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  SANDBOX_CPUS_MAX,
  SANDBOX_CPUS_MIN,
  SANDBOX_MEMORY_GIB_MAX,
  SANDBOX_MEMORY_GIB_MIN,
} from '@/lib/sandboxResources'

type SandboxResourceInputsProps = {
  idPrefix: string
  cpus: string
  onCpusChange: (value: string) => void
  memoryGib: string
  onMemoryGibChange: (value: string) => void
  cpusPlaceholder?: string
  memoryPlaceholder?: string
  disabled?: boolean
  error?: string | null
}

export function SandboxResourceInputs({
  idPrefix,
  cpus,
  onCpusChange,
  memoryGib,
  onMemoryGibChange,
  cpusPlaceholder,
  memoryPlaceholder,
  disabled,
  error,
}: SandboxResourceInputsProps) {
  const cpusId = `${idPrefix}-cpus`
  const memoryId = `${idPrefix}-memory`

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor={cpusId}>CPUs</Label>
          <Input
            id={cpusId}
            type="number"
            min={SANDBOX_CPUS_MIN}
            max={SANDBOX_CPUS_MAX}
            step={1}
            inputMode="numeric"
            value={cpus}
            onChange={(event) => onCpusChange(event.target.value)}
            placeholder={cpusPlaceholder}
            disabled={disabled}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={memoryId}>Memory (GiB)</Label>
          <Input
            id={memoryId}
            type="number"
            min={SANDBOX_MEMORY_GIB_MIN}
            max={SANDBOX_MEMORY_GIB_MAX}
            step={0.5}
            value={memoryGib}
            onChange={(event) => onMemoryGibChange(event.target.value)}
            placeholder={memoryPlaceholder}
            disabled={disabled}
          />
        </div>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  )
}
