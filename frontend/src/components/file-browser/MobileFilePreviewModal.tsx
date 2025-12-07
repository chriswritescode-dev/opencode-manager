import { memo, useCallback, useState, useEffect, useRef } from "react";
import { FilePreview } from "./FilePreview";
import type { FileInfo } from "@/types/files";
import { GPU_ACCELERATED_STYLE, MODAL_TRANSITION_MS } from "@/lib/utils";
import { useSwipeBack } from "@/hooks/useMobile";

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
  
  const { bind, swipeStyles } = useSwipeBack(onClose, {
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

  const handleClose = useCallback(() => {
    if (isClosingRef.current) return;
    isClosingRef.current = true;
    onClose();
    setTimeout(() => {
      setLocalFile(null);
      isClosingRef.current = false;
    }, MODAL_TRANSITION_MS);
  }, [onClose]);

  if (!isOpen || !localFile) {
    return null;
  }

  return (
    <div 
      ref={containerRef}
      className="fixed inset-0 z-50 bg-background"
      style={{ isolation: 'isolate', ...GPU_ACCELERATED_STYLE, ...swipeStyles }}
    >
      <div
        className={`h-full overflow-hidden bg-background ${showFilePreviewHeader ? "" : "pb-8"}`}
      >
        <FilePreview
          file={localFile}
          hideHeader={!showFilePreviewHeader}
          isMobileModal={showFilePreviewHeader}
          onCloseModal={handleClose}
        />
      </div>
    </div>
  );
})
