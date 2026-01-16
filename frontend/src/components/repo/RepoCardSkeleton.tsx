export function RepoCardSkeleton() {
  return (
    <div className="relative border rounded-xl overflow-hidden border-border bg-card w-full">
      <div className="p-2">
        <div className="flex items-start gap-3 mb-1">
          <div className="w-5 h-5 bg-muted animate-pulse rounded" />
          <div className="h-5 bg-muted animate-pulse rounded w-32" />
        </div>
        <div className="flex items-center gap-2 text-sm">
          <div className="flex flex-1 items-center gap-3">
            <div className="h-4 bg-muted animate-pulse rounded w-20" />
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <div className="h-8 w-8 bg-muted animate-pulse rounded" />
            <div className="h-8 w-8 bg-muted animate-pulse rounded" />
            <div className="h-8 w-8 bg-muted animate-pulse rounded" />
          </div>
        </div>
      </div>
    </div>
  )
}
