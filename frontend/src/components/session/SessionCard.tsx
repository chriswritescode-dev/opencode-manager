import { useRef, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { SessionStatusIndicator } from "@/components/ui/session-status-indicator";
import { Trash2, Clock, MoreVertical, Pin, PinOff, Pencil } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import type { Session } from "@/api/types";
import { useSwipe } from "@/hooks/useSwipe";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";

const SWIPE_ACTION_WIDTH = 44;

interface SessionCardProps {
  session: Session;
  isSelected: boolean;
  manageMode: boolean;
  isPinned?: boolean;
  onTogglePin?: () => void;
  onRename?: () => void;
  onSelect: (sessionID: string) => void;
  onToggleSelection: (selected: boolean) => void;
  onDelete: (e: React.MouseEvent<HTMLElement>) => void;
}

export const SessionCard = ({
  session,
  isSelected,
  manageMode,
  isPinned,
  onTogglePin,
  onRename,
  onSelect,
  onToggleSelection,
  onDelete,
}: SessionCardProps) => {
  const cardRef = useRef<HTMLDivElement>(null);
  const actionCount = (onTogglePin ? 1 : 0) + (onRename ? 1 : 0) + 1;
  const actionsWidth = actionCount * SWIPE_ACTION_WIDTH;
  const { bind, swipeOffset, isOpen, isSwipingBack, close, swipeStyles } = useSwipe({
    threshold: actionsWidth,
  });

  useEffect(() => {
    if (cardRef.current) {
      return bind(cardRef.current);
    }
  }, [bind]);

  const handleDeleteClick = (e: React.MouseEvent<HTMLElement>) => {
    e.stopPropagation();
    onDelete(e);
    close();
  };

  return (
    <div className="relative" data-row-swipe="" onClick={close}>
      <div
        className={`absolute top-0.5 right-0 bottom-0.5 flex overflow-hidden rounded-r-lg transition-opacity ${
          !isSwipingBack && (isOpen || swipeOffset > 40) ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
        style={{ width: actionsWidth }}
      >
        {onTogglePin && (
          <button
            aria-label={isPinned ? "Unpin session" : "Pin session"}
            className="h-full w-11 flex items-center justify-center bg-muted text-muted-foreground hover:bg-muted/80"
            onClick={(e) => {
              e.stopPropagation();
              onTogglePin();
              close();
            }}
          >
            {isPinned ? <PinOff className="w-5 h-5" /> : <Pin className="w-5 h-5" />}
          </button>
        )}
        {onRename && (
          <button
            aria-label="Rename session"
            className="h-full w-11 flex items-center justify-center bg-muted text-muted-foreground hover:bg-muted/80"
            onClick={(e) => {
              e.stopPropagation();
              onRename();
              close();
            }}
          >
            <Pencil className="w-5 h-5" />
          </button>
        )}
        <button
          aria-label="Delete session"
          className="h-full w-11 flex items-center justify-center bg-destructive text-destructive-foreground hover:bg-destructive/90"
          onClick={handleDeleteClick}
        >
          <Trash2 className="w-5 h-5" />
        </button>
      </div>
      <div ref={cardRef} style={swipeStyles}>
        <Card
          className={`group p-2 cursor-pointer transition-all overflow-hidden ${
            isOpen
              ? "rounded-none"
              : "rounded-r-lg"
          } ${
            isSelected
              ? "border-primary shadow-lg shadow-primary/30 bg-accent"
              : "bg-card border-border hover:bg-accent hover:border-border"
          } hover:shadow-lg`}
          onClick={() => {
            if (!isOpen) {
              if (manageMode) {
                onToggleSelection(!isSelected);
              } else {
                onSelect(session.id);
              }
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
                    <SessionStatusIndicator sessionID={session.id} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1">
                    {isPinned && <Pin className="w-3 h-3 text-highlight shrink-0" />}
                    <h3 className="text-base font-semibold text-highlight truncate">
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
              <>
                <div className="flex flex-col flex-1 min-w-0">
                  <div className="flex items-center gap-1">
                    {isPinned && <Pin className="w-3 h-3 text-highlight shrink-0" />}
                    <h3 className="text-sm font-semibold text-highlight truncate">
                      {session.title || "Untitled Session"}
                    </h3>
                  </div>
                  <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground">
                    <span className="flex items-center">
                      <Clock className="w-3 h-3 mr-1" />
                      {formatDistanceToNow(new Date(session.time.updated), {
                        addSuffix: true,
                      })}
                    </span>
                    <SessionStatusIndicator sessionID={session.id} />
                  </div>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      aria-label="Session actions"
                      size="sm"
                      variant="ghost"
                      className="h-7 w-7 p-0 shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 pointer-coarse:h-11 pointer-coarse:w-11 pointer-coarse:opacity-100"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <MoreVertical className="w-4 h-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="end"
                    className="z-[200]"
                    onClick={(e) => e.stopPropagation()}
                    onPointerDown={(e) => e.stopPropagation()}
                  >
                    {onTogglePin && (
                      <DropdownMenuItem onClick={() => onTogglePin()}>
                        {isPinned ? <PinOff className="w-4 h-4 mr-2" /> : <Pin className="w-4 h-4 mr-2" />}
                        {isPinned ? "Unpin" : "Pin to top"}
                      </DropdownMenuItem>
                    )}
                    {onRename && (
                      <DropdownMenuItem onClick={() => onRename()}>
                        <Pencil className="w-4 h-4 mr-2" />
                        Rename
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem className="text-destructive" onClick={(e) => onDelete(e)}>
                      <Trash2 className="w-4 h-4 mr-2" />
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            )}
            {manageMode && (
              <button
                aria-label="Delete session"
                className="h-6 w-6 p-0 text-foreground hover:text-destructive bg-transparent border-none cursor-pointer"
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
