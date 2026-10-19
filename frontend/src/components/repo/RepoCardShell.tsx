import type { ReactNode } from "react";

interface RepoCardShellProps {
  title: string;
  meta: ReactNode;
  statusDotClassName?: string;
  activity?: ReactNode;
  actions?: ReactNode;
  activityLabel?: string;
  isInteractive?: boolean;
  isSelected?: boolean;
  onClick?: () => void;
}

export function RepoCardShell({
  title,
  meta,
  statusDotClassName,
  activity,
  actions,
  activityLabel,
  isInteractive = false,
  isSelected = false,
  onClick,
}: RepoCardShellProps) {
  return (
    <div
      onClick={onClick}
      className={`relative border rounded-xl overflow-hidden transition-all duration-200 w-full ${
        isInteractive ? "cursor-pointer active:scale-[0.98] hover:border-primary/50 hover:bg-accent/50 hover:shadow-md" : "cursor-default"
      } ${
        isSelected ? "border-primary bg-primary/5" : "border-border bg-card"
      }`}
    >
      <div className="p-1.5">
        <div>
          <div className="flex items-start gap-2 mb-1">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <h3 className="font-semibold text-base text-foreground truncate">
                {title}
              </h3>
              {statusDotClassName && (
                <div className={`w-2 h-2 rounded-full shrink-0 ${statusDotClassName}`} />
              )}
              {activity}
            </div>

            {actions}
          </div>

          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <div className="flex flex-1 items-center gap-2 min-w-0 overflow-hidden">
              {meta}
            </div>

            {activityLabel && (
              <span className="text-xs text-muted-foreground/70 shrink-0">
                {activityLabel}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
