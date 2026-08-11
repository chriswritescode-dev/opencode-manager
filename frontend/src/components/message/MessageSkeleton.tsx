

export function MessageSkeleton() {
  return (
    <div className="flex flex-col space-y-2 p-2 overflow-x-hidden">
      {/* User message skeleton */}
      <div className="flex flex-col">
        <div className="w-full rounded-lg border border-primary/25 bg-primary/10 p-1.5">
          <div className="flex items-center gap-2 mb-1">
            <div className="h-3 w-12 bg-muted animate-pulse rounded" />
            <div className="h-3 w-16 bg-muted animate-pulse rounded" />
          </div>
          <div className="space-y-2">
            <div className="h-4 bg-muted animate-pulse rounded w-3/4" />
            <div className="h-4 bg-muted animate-pulse rounded w-1/2" />
          </div>
        </div>
      </div>

      {/* Assistant message skeleton */}
      <div className="flex flex-col">
        <div className="w-full rounded-lg p-1.5 bg-card/50 border border-border">
          <div className="flex items-center gap-2 mb-1">
            <div className="h-3 w-16 bg-muted animate-pulse rounded" />
            <div className="h-3 w-16 bg-muted animate-pulse rounded" />
            <div className="flex items-center gap-1">
              <div className="h-3 w-20 rounded bg-primary/12 animate-pulse" />
            </div>
          </div>
          <div className="space-y-2">
            <div className="h-4 bg-muted animate-pulse rounded w-full" />
            <div className="h-4 bg-muted animate-pulse rounded w-5/6" />
            <div className="h-4 bg-muted animate-pulse rounded w-2/3" />
            <div className="h-20 bg-muted/50 animate-pulse rounded mt-3" />
          </div>
        </div>
      </div>
      <div className="flex flex-col">
        <div className="w-full rounded-lg border border-primary/25 bg-primary/10 p-1.5">
          <div className="flex items-center gap-2 mb-1">
            <div className="h-3 w-12 bg-muted animate-pulse rounded" />
            <div className="h-3 w-16 bg-muted animate-pulse rounded" />
          </div>
          <div className="space-y-2">
            <div className="h-4 bg-muted animate-pulse rounded w-3/4" />
            <div className="h-4 bg-muted animate-pulse rounded w-1/2" />
          </div>
        </div>
      </div>

      {/* Assistant message skeleton */}
      <div className="flex flex-col">
        <div className="w-full rounded-lg p-1.5 bg-card/50 border border-border">
          <div className="flex items-center gap-2 mb-1">
            <div className="h-3 w-16 bg-muted animate-pulse rounded" />
            <div className="h-3 w-16 bg-muted animate-pulse rounded" />
            <div className="flex items-center gap-1">
              <div className="h-3 w-20 rounded bg-primary/12 animate-pulse" />
            </div>
          </div>
          <div className="space-y-2">
            <div className="h-4 bg-muted animate-pulse rounded w-full" />
            <div className="h-4 bg-muted animate-pulse rounded w-5/6" />
            <div className="h-4 bg-muted animate-pulse rounded w-2/3" />
            <div className="h-20 bg-muted/50 animate-pulse rounded mt-3" />
          </div>
        </div>
      </div>

      {/* Second user message skeleton */}
      <div className="flex flex-col">
        <div className="w-full rounded-lg border border-primary/25 bg-primary/10 p-1.5">
          <div className="flex items-center gap-2 mb-1">
            <div className="h-3 w-12 bg-muted animate-pulse rounded" />
            <div className="h-3 w-16 bg-muted animate-pulse rounded" />
          </div>
          <div className="space-y-2">
            <div className="h-4 bg-muted animate-pulse rounded w-4/5" />
          </div>
        </div>
      </div>

      {/* Loading assistant message */}
      <div className="flex flex-col">
        <div className="w-full rounded-lg p-1.5 bg-card/50 border border-border animate-pulse-subtle">
          <div className="flex items-center gap-2 mb-1">
            <div className="h-3 w-16 bg-muted animate-pulse rounded" />
            <div className="h-3 w-16 bg-muted animate-pulse rounded" />
            <div className="flex items-center gap-1">
              <span className="animate-pulse">●</span>
              <div className="h-3 w-24 rounded bg-primary/12 animate-pulse" />
            </div>
          </div>
          <div className="flex items-center gap-2 text-muted-foreground">
            <span className="animate-pulse">▋</span>
            <div className="h-4 w-20 bg-muted animate-pulse rounded" />
          </div>
        </div>
      </div>
    </div>
  );
}
