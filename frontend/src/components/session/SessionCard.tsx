import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { MiniScanner } from "@/components/ui/mini-scanner";
import { Trash2, Clock } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import type { Session } from "@/api/types";

interface SessionCardProps {
  session: Session;
  isSelected: boolean;
  isActive: boolean;
  onSelect: (sessionID: string) => void;
  onToggleSelection: (selected: boolean) => void;
  onDelete: (e: React.MouseEvent<HTMLButtonElement>) => void;
}

export const SessionCard = ({
  session,
  isSelected,
  isActive,
  onSelect,
  onToggleSelection,
  onDelete,
}: SessionCardProps) => {

  return (
    <Card
      className={`p-3 cursor-pointer transition-all ${
        isSelected
          ? "border-blue-500 shadow-lg shadow-blue-900/30 dark:shadow-blue-900/30 bg-accent"
          : isActive
            ? "bg-accent border-border"
            : "bg-card border-border hover:bg-accent hover:border-border"
      } hover:shadow-lg`}
      onClick={() => onSelect(session.id)}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2 flex-1 min-w-0">
          <div className="flex flex-col items-center gap-3 flex-shrink-0">
            <Checkbox
              checked={isSelected}
              onCheckedChange={(checked) => {
                onToggleSelection(checked === true);
              }}
              onClick={(e) => {
                e.stopPropagation();
              }}
              className="w-5 h-5 flex-shrink-0"
            />
            <MiniScanner sessionID={session.id} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="text-base font-semibold text-orange-600 dark:text-orange-400 truncate">
                {session.title || "Untitled Session"}
              </h3>
            </div>
            <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {formatDistanceToNow(new Date(session.time.updated), {
                  addSuffix: true,
                })}
              </span>
            </div>
          </div>
        </div>
        <button
          className="h-6 w-6 p-0 text-foreground hover:text-red-600 dark:hover:text-red-400 bg-transparent border-none cursor-pointer"
          onClick={onDelete}
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    </Card>
  );
};
