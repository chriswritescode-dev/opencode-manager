import { memo, useCallback, useState, useEffect, useRef } from "react";
import { FilePreview } from "./FilePreview";
import { FullscreenSheet } from "@/components/ui/fullscreen-sheet";
import { Button } from "@/components/ui/button";
import type { FileInfo } from "@/types/files";
import { GPU_ACCELERATED_STYLE, MODAL_TRANSITION_MS } from "@/lib/utils";
import { useSwipeBack } from "@/hooks/useMobile";
import { X } from "lucide-react";

interface MobileFilePreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  file: FileInfo | null;
  showFilePreviewHeader?: boolean;
}

export const MobileFilePreviewModal = memo(function MobileFilePreviewModal({
  isOpen,
  onClose,
  file,
  showFilePreviewHeader = false,
}: MobileFilePreviewModalProps) {
  const [localFile, setLocalFile] = useState<FileInfo | null>(null);
  const isClosingRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  
  const handleClose = useCallback(() => {
    if (isClosingRef.current) return;
    isClosingRef.current = true;
    onClose();
    setTimeout(() => {
      setLocalFile(null);
      isClosingRef.current = false;
    }, MODAL_TRANSITION_MS);
  }, [onClose]);
  
  const { bind, swipeStyles } = useSwipeBack(handleClose, {
    enabled: isOpen,
  });
  
  useEffect(() => {
    return bind(containerRef.current);
  }, [bind]);

  useEffect(() => {
    if (isOpen && file && !file.isDirectory) {
      setLocalFile(file);
      isClosingRef.current = false;
    }
  }, [isOpen, file]);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        handleClose();
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
    }

    return () => {
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen, handleClose]);

  if (!isOpen || !localFile) {
    return null;
  }

  return (
    <div ref={containerRef} style={{ isolation: 'isolate' }}>
      <FullscreenSheet className="h-dvh max-h-dvh w-screen max-w-screen overflow-hidden" style={{ ...GPU_ACCELERATED_STYLE, ...swipeStyles }}>
        <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-background pt-safe">
          {!showFilePreviewHeader && (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={handleClose}
              aria-label="Close preview"
              className="absolute right-2 top-2 z-10"
            >
              <X className="size-4" />
            </Button>
          )}
          <FilePreview
            key={localFile.path}
            file={localFile}
            hideHeader={!showFilePreviewHeader}
            isMobileModal
            onCloseModal={handleClose}
          />
        </div>
      </FullscreenSheet>
    </div>
  );
})
