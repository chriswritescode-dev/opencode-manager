function SkeletonBlock({ className }: { className?: string }) {
  return <div className={`bg-muted animate-pulse rounded ${className ?? ''}`} />
}

function DesktopSidebarSkeleton() {
  return (
    <div className="hidden sm:flex flex-col w-60 shrink-0 h-full border-r border-border bg-card p-3 gap-3">
      <SkeletonBlock className="h-8 w-32 mb-2" />
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex items-center gap-2">
          <SkeletonBlock className="h-4 w-4 shrink-0" />
          <SkeletonBlock className="h-4 flex-1" />
        </div>
      ))}
      <div className="mt-auto flex items-center gap-2">
        <SkeletonBlock className="h-7 w-7 rounded-full shrink-0" />
        <SkeletonBlock className="h-4 w-24" />
      </div>
    </div>
  )
}

function MobileTabBarSkeleton() {
  return (
    <div className="sm:hidden fixed bottom-0 inset-x-0 h-16 border-t border-border bg-card flex items-center justify-around px-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="flex flex-col items-center gap-1">
          <SkeletonBlock className="h-5 w-5" />
          <SkeletonBlock className="h-2.5 w-8" />
        </div>
      ))}
    </div>
  )
}

function ContentSkeleton() {
  return (
    <div className="flex-1 min-w-0 flex flex-col p-4 gap-4 overflow-hidden">
      <SkeletonBlock className="h-8 w-48" />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="border border-border rounded-xl p-3 bg-card space-y-2">
            <div className="flex items-center gap-2">
              <SkeletonBlock className="h-5 w-5 shrink-0" />
              <SkeletonBlock className="h-5 w-32" />
            </div>
            <SkeletonBlock className="h-4 w-20" />
          </div>
        ))}
      </div>
    </div>
  )
}

export function AppLoadingSkeleton() {
  return (
    <div className="flex h-dvh w-full min-w-0 bg-background">
      <DesktopSidebarSkeleton />
      <ContentSkeleton />
      <MobileTabBarSkeleton />
    </div>
  )
}
