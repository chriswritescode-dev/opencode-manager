import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { X, Check } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { useMobile } from "@/hooks/useMobile";

interface EditSessionTitleDialogProps {
  isOpen: boolean;
  currentTitle: string;
  onClose: () => void;
  onSave: (newTitle: string) => void;
}

export function EditSessionTitleDialog({ isOpen, currentTitle, onClose, onSave }: EditSessionTitleDialogProps) {
  const [editTitle, setEditTitle] = useState(currentTitle);
  const inputRef = useRef<HTMLInputElement>(null);
  const isMobile = useMobile();

  useEffect(() => {
    if (isOpen) {
      setEditTitle(currentTitle);
    }
  }, [isOpen, currentTitle]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setEditTitle(currentTitle);
      onClose();
    } else if (e.key === 'Enter') {
      if (editTitle.trim() && editTitle !== currentTitle) {
        onSave(editTitle.trim());
      }
      onClose();
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editTitle.trim() && editTitle !== currentTitle) {
      onSave(editTitle.trim());
    }
    onClose();
  };

  const handleCancel = () => {
    setEditTitle(currentTitle);
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent 
        hideCloseButton
        className={isMobile 
          ? "w-screen max-w-none left-0 top-0 translate-x-0 translate-y-0 rounded-none border-0 border-b bg-background p-4 gap-0 pt-safe"
          : "p-6 gap-0"
        }
      >
        <form onSubmit={handleSubmit} className="min-w-0">
          <p className="text-sm text-muted-foreground mb-2">Change session title</p>
          <div className="relative">
            <input
              ref={inputRef}
              type="text"
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              onKeyDown={handleKeyDown}
              className="text-base font-semibold bg-background border border-border rounded px-3 py-2.5 pr-10 outline-none w-full focus:border-primary focus:ring-2 focus:ring-primary/20"
              autoFocus
            />
            {editTitle && (
              <button
                type="button"
                onClick={() => {
                  setEditTitle("");
                  inputRef.current?.focus();
                }}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-full hover:bg-red-500/10 text-red-500 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            )}
          </div>
          <div className="flex items-center gap-2 mt-3">
            <Button
              type="button"
              variant="outline"
              onClick={handleCancel}
              className="flex-1 h-10"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              className="flex-1 h-10"
            >
              <Check className="w-4 h-4 mr-2" />
              Save
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}