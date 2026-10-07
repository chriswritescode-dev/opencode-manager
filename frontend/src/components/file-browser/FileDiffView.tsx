import { useFileDiff, useCommitFileDiff } from "@/api/git";
import {
  Loader2,
  FileText,
  FilePlus,
  FileX,
  FileEdit,
  File,
  ArrowLeft,
  ExternalLink,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { cn } from "@/lib/utils";
import type { GitFileStatusType } from "@/types/git";
import { GIT_STATUS_COLORS, GIT_STATUS_LABELS } from "@/lib/git-status-styles";
import { DiffLines } from "./DiffLines";

interface FileDiffViewProps {
  repoId: number;
  filePath: string;
  includeStaged?: boolean;
  commitHash?: string;
  onBack?: () => void;
  onClose?: () => void;
  onOpenFile?: (path: string, lineNumber?: number) => void;
  isMobile?: boolean;
}

const statusConfig: Record<
  GitFileStatusType,
  { icon: typeof FileText; color: string; bgColor: string; label: string }
> = {
  modified: {
    icon: FileEdit,
    color: GIT_STATUS_COLORS.modified,
    bgColor: "bg-warning/10",
    label: GIT_STATUS_LABELS.modified,
  },
  added: {
    icon: FilePlus,
    color: GIT_STATUS_COLORS.added,
    bgColor: "bg-success/10",
    label: GIT_STATUS_LABELS.added,
  },
  deleted: {
    icon: FileX,
    color: GIT_STATUS_COLORS.deleted,
    bgColor: "bg-destructive/10",
    label: GIT_STATUS_LABELS.deleted,
  },
  renamed: {
    icon: FileText,
    color: GIT_STATUS_COLORS.renamed,
    bgColor: "bg-info/10",
    label: GIT_STATUS_LABELS.renamed,
  },
  untracked: {
    icon: File,
    color: GIT_STATUS_COLORS.untracked,
    bgColor: "bg-muted/50",
    label: GIT_STATUS_LABELS.untracked,
  },
  copied: {
    icon: FileText,
    color: GIT_STATUS_COLORS.copied,
    bgColor: "bg-success/10",
    label: GIT_STATUS_LABELS.copied,
  },
};

export function FileDiffView({
  repoId,
  filePath,
  includeStaged,
  commitHash,
  onBack,
  onClose,
  onOpenFile,
  isMobile = false,
}: FileDiffViewProps) {
  const workingDiff = useFileDiff(repoId, filePath, includeStaged);
  const commitDiff = useCommitFileDiff(repoId, commitHash, filePath);
  const { data: diffData, isLoading, error } = commitHash ? commitDiff : workingDiff;

  const fileName = filePath.split("/").pop() || filePath;
  const dirPath = filePath.includes("/")
    ? filePath.substring(0, filePath.lastIndexOf("/"))
    : "";

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full py-8">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full py-8 text-muted-foreground">
        <FileText className="w-8 h-8 mb-2 opacity-50" />
        <p className="text-sm">Failed to load diff</p>
        <p className="text-xs mt-1">{error.message}</p>
        {onBack && (
          <Button variant="ghost" size="sm" onClick={onBack} className="mt-4">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back
          </Button>
        )}
      </div>
    );
  }

  if (!diffData) {
    return null;
  }

  const config = statusConfig[diffData.status];
  const Icon = config.icon;

  return (
    <div className="flex flex-col h-full bg-background overflow-hidden">
      <div
        className={cn(
          "flex items-center gap-2 px-3 py-2 border-b border-border flex-shrink-0",
          config.bgColor,
        )}
      >
        {onBack && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onBack}
            className="h-7 w-7 p-0 mr-1"
          >
            <ArrowLeft className="w-4 h-4" />
          </Button>
        )}
        <Icon className={cn("w-4 h-4 flex-shrink-0", config.color)} />
        <div className="flex-1 min-w-0">
          {onOpenFile ? (
            <button
              onClick={() => onOpenFile(filePath)}
              className="text-left group"
            >
              <div className="text-sm font-medium text-foreground truncate group-hover:text-primary group-hover:underline flex items-center gap-1">
                {fileName}
                <ExternalLink className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
              {dirPath && (
                <div className="text-xs text-muted-foreground truncate">
                  {dirPath}
                </div>
              )}
            </button>
          ) : (
            <>
              <div className="text-sm font-medium text-foreground truncate">
                {fileName}
              </div>
              {dirPath && (
                <div className="text-xs text-muted-foreground truncate">
                  {dirPath}
                </div>
              )}
            </>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs flex-shrink-0">
          <span
            className={cn(
              "px-1.5 py-0.5 rounded",
              config.bgColor,
              config.color,
            )}
          >
            {config.label}
          </span>
          {!diffData.isBinary && (
            <>
              <span className="text-diff-add">+{diffData.additions}</span>
              <span className="text-diff-delete">-{diffData.deletions}</span>
            </>
          )}
          {diffData.diff && (
            <CopyButton
              content={diffData.diff || ""}
              title="Copy diff"
              iconSize="sm"
              variant="ghost"
              className="flex-shrink-0"
            />
          )}
          {onClose && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0 flex-shrink-0"
              onClick={onClose}
            >
              <X className="w-4 h-4" />
            </Button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto overflow-x-hidden min-h-0">
        {diffData.isBinary ? (
          <div className="flex items-center justify-center h-full text-muted-foreground bg-muted/20">
            <p className="text-sm">Binary file - cannot display diff</p>
          </div>
        ) : !diffData.diff ? (
          <div className="flex items-center justify-center h-full text-muted-foreground bg-muted/20">
            <p className="text-sm">No changes to display</p>
          </div>
        ) : (
          <div className="border-t border-border/30">
            <DiffLines
              diff={diffData.diff}
              showLineNumbers={!isMobile}
              onLineClick={
                onOpenFile
                  ? (lineNum) => onOpenFile(filePath, lineNum)
                  : undefined
              }
            />
          </div>
        )}
      </div>
    </div>
  );
}
