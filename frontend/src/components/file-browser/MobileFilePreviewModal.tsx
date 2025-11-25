import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FilePreview } from "./FilePreview";
import { X } from "lucide-react";
import type { FileInfo } from "@/types/files";

interface MobileFilePreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  file: FileInfo | null;
  showFilePreviewHeader?: boolean;
}

export function MobileFilePreviewModal({
  isOpen,
  onClose,
  file,
  showFilePreviewHeader = false,
}: MobileFilePreviewModalProps) {
  const handleTouchStart = (e: React.TouchEvent) => {
    e.preventDefault();
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    e.preventDefault();
  };

  if (!file || file.isDirectory) {
    return null;
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()} hideCloseButton={true}>
      <DialogContent
        className="w-screen h-screen max-w-none max-h-none p-0 bg-background border-0 flex flex-col"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        <div
          className={`flex-1 overflow-hidden min-h-0 ${showFilePreviewHeader ? "" : "pb-8"}`}
        >
          <FilePreview
            file={file}
            hideHeader={!showFilePreviewHeader}
            isMobileModal={showFilePreviewHeader}
            onCloseModal={onClose}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

