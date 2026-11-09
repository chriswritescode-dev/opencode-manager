import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface RenameSessionDialogProps {
  open: boolean;
  initialTitle: string;
  onSubmit: (title: string) => void;
  onOpenChange: (open: boolean) => void;
  isPending?: boolean;
}

export function RenameSessionDialog({
  open,
  initialTitle,
  onSubmit,
  onOpenChange,
  isPending = false,
}: RenameSessionDialogProps) {
  const [title, setTitle] = useState(initialTitle);

  useEffect(() => {
    if (open) {
      setTitle(initialTitle);
    }
  }, [open, initialTitle]);

  const trimmedTitle = title.trim();

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!trimmedTitle || isPending) return;
    onSubmit(trimmedTitle);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename Session</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <label htmlFor="rename-session-title" className="text-sm font-medium">
              Session title
            </label>
            <Input
              id="rename-session-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Session title"
              autoComplete="off"
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!trimmedTitle || isPending}>
              {isPending ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
