import { useState, useRef } from "react";
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
  const [swipeOffset, setSwipeOffset] = useState(0);
  const [isSwipeOpen, setIsSwipeOpen] = useState(false);
  const touchStartX = useRef<number | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (touchStartX.current === null) return;
    
    const currentX = e.touches[0].clientX;
    const diff = touchStartX.current - currentX;
    
    if (diff > 0) {
      const newOffset = Math.min(diff, 80);
      setSwipeOffset(newOffset);
    } else if (diff < 0 && isSwipeOpen) {
      const newOffset = Math.max(0, 80 + diff);
      setSwipeOffset(newOffset);
    }
  };

  const handleTouchEnd = () => {
    if (swipeOffset > 50) {
      setIsSwipeOpen(true);
      setSwipeOffset(80);
    } else if (swipeOffset < 30) {
      setIsSwipeOpen(false);
      setSwipeOffset(0);
    }
    touchStartX.current = null;
  };

  const closeSwipe = () => {
    setSwipeOffset(0);
    setIsSwipeOpen(false);
  };

  const handleDeleteClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    onDelete(e);
    closeSwipe();
  };

  return (
    <div className="relative" onClick={closeSwipe}>
      <div
        className={`absolute top-0.5 right-0 bottom-0.5 w-20 bg-red-600 flex items-center justify-center rounded-r-lg transition-opacity ${
          swipeOffset > 20 || isSwipeOpen ? "opacity-100" : "opacity-0"
        }`}
      >
        <button
          className="h-full w-full flex items-center justify-center text-white hover:bg-red-700"
          onClick={handleDeleteClick}
        >
          <Trash2 className="w-5 h-5" />
        </button>
      </div>
      <div
        ref={cardRef}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        style={{ transform: `translateX(-${swipeOffset}px)` }}
        className="transition-transform"
      >
        <Card
          className={`p-2 cursor-pointer transition-all overflow-hidden ${
            isSwipeOpen
              ? "rounded-none"
              : "rounded-r-lg"
          } ${
            isSelected
              ? "border-blue-500 shadow-lg shadow-blue-900/30 dark:shadow-blue-900/30 bg-accent"
              : isActive
                ? "bg-accent border-border"
                : "bg-card border-border hover:bg-accent hover:border-border"
          } hover:shadow-lg`}
          onClick={() => {
            if (!isSwipeOpen) {
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
                    <h3 className="text-base font-semibold text-orange-600 dark:text-orange-400 truncate">
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
                <h3 className="text-sm font-semibold text-orange-600 dark:text-orange-400 truncate">
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
                className="h-6 w-6 p-0 text-foreground hover:text-red-600 dark:hover:text-red-400 bg-transparent border-none cursor-pointer"
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
