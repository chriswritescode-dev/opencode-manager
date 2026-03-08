import { useRef, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { MiniScanner } from "@/components/ui/mini-scanner";
import { Trash2, Clock } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import type { Session } from "@/api/types";
import { useSwipe } from "@/hooks/useSwipe";

interface SessionCardProps {
  session: Session;
  isSelected: boolean;
  isActive: boolean;
  manageMode: boolean;
  onSelect: (sessionID: string) => void;
  onToggleSelection: (selected: boolean) => void;
  onDelete: (e: React.MouseEvent<HTMLButtonElement>) => void;
}

export const SessionCard = ({
  session,
  isSelected,
  isActive,
  manageMode,
  onSelect,
  onToggleSelection,
  onDelete,
}: SessionCardProps) => {
  const cardRef = useRef<HTMLDivElement>(null);
  const { bind, swipeOffset, isOpen, isSwipingBack, close, swipeStyles } = useSwipe();

  useEffect(() => {
    if (cardRef.current) {
      return bind(cardRef.current);
    }
  }, [bind]);

  const handleDeleteClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    onDelete(e);
    close();
  };

  return (
    <div className="relative" onClick={close}>
      <div
        className={`absolute top-0.5 right-0 bottom-0.5 flex w-20 items-center justify-center rounded-r-lg bg-destructive transition-opacity ${
          !isSwipingBack && (isOpen || swipeOffset > 40) ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
      >
        <button
          className="flex h-full w-full items-center justify-center text-destructive-foreground hover:bg-destructive/90"
          onClick={handleDeleteClick}
        >
          <Trash2 className="w-5 h-5" />
        </button>
      </div>
      <div ref={cardRef} style={swipeStyles}>
        <Card
          className={`p-2 cursor-pointer transition-all overflow-hidden ${
            isOpen
              ? "rounded-none"
              : "rounded-r-lg"
            } ${
              isSelected
                ? "border-primary/50 bg-accent shadow-lg shadow-primary/15"
                : isActive
                  ? "bg-accent border-border"
                  : "bg-card border-border hover:bg-accent hover:border-border"
          } hover:shadow-lg`}
          onClick={() => {
            if (!isOpen) {
              onSelect(session.id);
            }
          }}
        >
          <div className="flex items-start justify-between gap-2">
            {manageMode ? (
              <div className="flex items-start gap-2 flex-1 min-w-0">
                <div className="flex flex-col items-center gap-2 flex-shrink-0">
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
                  <div className="flex items-center gap-1">
                    <h3 className="truncate text-base font-semibold text-warning">
                      {session.title || "Untitled Session"}
                    </h3>
                  </div>
                  <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {formatDistanceToNow(new Date(session.time.updated), {
                        addSuffix: true,
                      })}
                    </span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex flex-col flex-1 min-w-0">
                <h3 className="truncate text-sm font-semibold text-warning">
                  {session.title || "Untitled Session"}
                </h3>
                <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground">
                  <span className="flex items-center">
                    <Clock className="w-3 h-3 mr-1" />
                    {formatDistanceToNow(new Date(session.time.updated), {
                      addSuffix: true,
                    })}
                  </span>
                  <MiniScanner sessionID={session.id} />
                </div>
              </div>
            )}
            {manageMode && (
              <button
                className="h-6 w-6 cursor-pointer border-none bg-transparent p-0 text-foreground hover:text-destructive"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(e);
                }}
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
};
