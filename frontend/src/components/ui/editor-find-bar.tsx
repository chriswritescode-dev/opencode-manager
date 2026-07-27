import { Search, ChevronUp, ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

interface EditorFindBarProps {
  query: string
  onQueryChange: (query: string) => void
  matchCount: number
  currentMatch: number
  onPrev: () => void
  onNext: () => void
  inputName: string
  placeholder?: string
  className?: string
}

export function EditorFindBar({
  query,
  onQueryChange,
  matchCount,
  currentMatch,
  onPrev,
  onNext,
  inputName,
  placeholder = 'Find in content...',
  className,
}: EditorFindBarProps) {
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (e.shiftKey) onPrev()
      else onNext()
    }
  }

  const noMatches = matchCount === 0

  return (
    <div className={cn('flex shrink-0 items-center gap-2 border-b bg-muted/30 px-3 py-2', className)}>
      <div className="relative flex-1">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          aria-label="Find in content"
          autoComplete="off"
          name={inputName}
          className="pl-9 h-10 md:h-9 text-[16px] md:text-sm"
        />
      </div>
      {query && (
        <span data-testid="find-match-count" className="whitespace-nowrap text-xs text-muted-foreground">
          {matchCount > 0 ? `${currentMatch} of ${matchCount}` : '0 matches'}
        </span>
      )}
      <Button
        type="button"
        variant="ghost"
        size="icon-lg"
        className="md:size-8"
        aria-label="Previous match"
        disabled={noMatches}
        onClick={onPrev}
      >
        <ChevronUp className="h-4 w-4" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-lg"
        className="md:size-8"
        aria-label="Next match"
        disabled={noMatches}
        onClick={onNext}
      >
        <ChevronDown className="h-4 w-4" />
      </Button>
    </div>
  )
}
