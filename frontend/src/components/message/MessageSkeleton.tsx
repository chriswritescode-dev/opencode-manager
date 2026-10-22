import { cn } from '@/lib/utils'

function Bar({ className }: { className: string }) {
  return <div className={cn('animate-pulse rounded', className)} />
}

function UserTurnSkeleton({ widths }: { widths: string[] }) {
  return (
    <div className="py-2">
      <div className="border-l-[3px] border-primary/40 bg-muted px-4 py-3">
        <div className="space-y-2">
          {widths.map((width, index) => (
            <Bar key={index} className={cn('h-4 bg-accent', width)} />
          ))}
        </div>
        <Bar className="mt-3 h-3 w-16 bg-accent" />
      </div>
    </div>
  )
}

function TurnFooterSkeleton() {
  return (
    <div className="mt-3 flex items-center gap-2">
      <Bar className="h-3 w-10 bg-primary/30" />
      <Bar className="h-3 w-24 bg-muted" />
      <Bar className="h-3 w-12 bg-muted" />
    </div>
  )
}

function AssistantTurnSkeleton() {
  return (
    <div className="py-2">
      <div className="space-y-2">
        <Bar className="h-4 w-full bg-muted" />
        <Bar className="h-4 w-5/6 bg-muted" />
        <div className="flex items-center gap-2 py-0.5">
          <Bar className="h-3 w-3 bg-muted" />
          <Bar className="h-3 w-40 bg-muted" />
        </div>
        <div className="space-y-1.5 bg-muted px-3 py-2 md:px-4 md:py-3">
          <Bar className="h-3 w-1/2 bg-accent" />
          <Bar className="h-3 w-3/4 bg-accent" />
          <Bar className="h-3 w-2/3 bg-accent" />
        </div>
        <Bar className="h-4 w-2/3 bg-muted" />
      </div>
      <TurnFooterSkeleton />
    </div>
  )
}

/** Placeholder transcript shown while a session loads, mirroring the CLI-style turn layout. */
export function MessageSkeleton() {
  return (
    <div className="flex flex-col overflow-x-hidden p-2" aria-hidden="true">
      <UserTurnSkeleton widths={['w-3/4', 'w-1/2']} />
      <AssistantTurnSkeleton />
      <UserTurnSkeleton widths={['w-4/5']} />
      <AssistantTurnSkeleton />
      <UserTurnSkeleton widths={['w-2/3']} />
      <div className="py-2">
        <div className="flex items-center gap-2 text-muted-foreground">
          <span className="animate-pulse">▋</span>
          <Bar className="h-4 w-20 bg-muted" />
        </div>
        <div className="mt-3 flex items-center gap-2">
          <Bar className="h-3 w-10 bg-primary/30" />
          <Bar className="h-3 w-24 bg-muted" />
          <span className="animate-pulse-subtle text-xs text-info">streaming</span>
        </div>
      </div>
    </div>
  )
}
