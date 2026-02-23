import { useFileDiff } from "@/api/git";
import {
  Loader2,
  FileText,
  FilePlus,
  FileX,
  FileEdit,
  File,
  Plus,
  Minus,
  ArrowLeft,
  ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { cn } from "@/lib/utils";
import type { GitFileStatusType } from "@/types/git";
import { GIT_STATUS_COLORS, GIT_STATUS_LABELS } from "@/lib/git-status-styles";

interface FileDiffViewProps {
  repoId: number;
  filePath: string;
  includeStaged?: boolean;
  onBack?: () => void;
  onOpenFile?: (path: string, lineNumber?: number) => void;
  isMobile?: boolean;
}

interface DiffLine {
  type: "add" | "remove" | "context" | "header" | "hunk";
  content: string;
  oldLineNumber?: number;
  newLineNumber?: number;
}

function parseDiff(diff: string): DiffLine[] {
  const lines = diff.split("\n");
  const result: DiffLine[] = [];
  let oldLine = 0;
  let newLine = 0;

  for (const line of lines) {
    if (
      line.startsWith("diff --git") ||
      line.startsWith("index ") ||
      line.startsWith("---") ||
      line.startsWith("+++")
    ) {
      result.push({ type: "header", content: line });
    } else if (line.startsWith("@@")) {
      const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (match) {
        oldLine = parseInt(match[1], 10);
        newLine = parseInt(match[2], 10);
      }
      result.push({ type: "hunk", content: line });
    } else if (line.startsWith("+")) {
      result.push({
        type: "add",
        content: line.substring(1),
        newLineNumber: newLine,
      });
      newLine++;
    } else if (line.startsWith("-")) {
      result.push({
        type: "remove",
        content: line.substring(1),
        oldLineNumber: oldLine,
      });
      oldLine++;
    } else if (line.startsWith(" ") || line === "") {
      result.push({
        type: "context",
        content: line.substring(1) || "",
        oldLineNumber: oldLine,
        newLineNumber: newLine,
      });
      oldLine++;
      newLine++;
    }
  }

  return result;
}

const statusConfig: Record<
  GitFileStatusType,
  { icon: typeof FileText; color: string; bgColor: string; label: string }
> = {
  modified: {
    icon: FileEdit,
    color: GIT_STATUS_COLORS.modified,
    bgColor: "bg-amber-500/10",
    label: GIT_STATUS_LABELS.modified,
  },
  added: {
    icon: FilePlus,
    color: GIT_STATUS_COLORS.added,
    bgColor: "bg-emerald-500/10",
    label: GIT_STATUS_LABELS.added,
  },
  deleted: {
    icon: FileX,
    color: GIT_STATUS_COLORS.deleted,
    bgColor: "bg-rose-500/10",
    label: GIT_STATUS_LABELS.deleted,
  },
  renamed: {
    icon: FileText,
    color: GIT_STATUS_COLORS.renamed,
    bgColor: "bg-blue-500/10",
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
    bgColor: "bg-emerald-500/10",
    label: GIT_STATUS_LABELS.copied,
  },
};

function DiffLineComponent({
  line,
  showLineNumbers,
  onLineClick,
}: {
  line: DiffLine;
  showLineNumbers: boolean;
  onLineClick?: (lineNumber: number) => void;
}) {
  if (line.type === "header") {
    return (
      <div className="px-4 py-1 bg-muted/50 text-muted-foreground text-xs font-mono truncate border-b border-border/30">
        {line.content}
      </div>
    );
  }

  if (line.type === "hunk") {
    return (
      <div className="px-4 py-1 bg-accent/20 text-accent-foreground text-xs font-mono border-b border-border/20">
        {line.content}
      </div>
    );
  }

  const bgClass =
    line.type === "add"
      ? "bg-emerald-500/10"
      : line.type === "remove"
        ? "bg-rose-500/10"
        : "";

  const textClass =
    line.type === "add"
      ? "text-emerald-700 dark:text-emerald-300"
      : line.type === "remove"
        ? "text-rose-700 dark:text-rose-300"
        : "text-foreground";

  const lineNumber = line.newLineNumber ?? line.oldLineNumber;
  const isClickable = onLineClick && lineNumber !== undefined;

  return (
    <div
      className={cn(
        "flex font-mono text-sm border-l-2 transition-colors",
        bgClass,
        line.type === "add" && "border-l-emerald-500",
        line.type === "remove" && "border-l-rose-500",
        line.type === "context" && "border-l-transparent",
        isClickable && "cursor-pointer hover:bg-accent/30",
      )}
      onClick={() =>
        isClickable && lineNumber !== undefined && onLineClick(lineNumber)
      }
    >
      {showLineNumbers && (
          <div className="flex-shrink-0 w-20 flex text-xs text-muted-foreground bg-muted/30 select-none">
          <span className="w-10 px-2 text-right border-r border-border/50">
            {line.oldLineNumber || ""}
          </span>
          <span className="w-10 px-2 text-right border-r border-border/50">
            {line.newLineNumber || ""}
          </span>
        </div>
      )}
      <div className="w-6 flex-shrink-0 flex items-center justify-center bg-muted/20">
        {line.type === "add" && (
          <Plus className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
        )}
        {line.type === "remove" && (
          <Minus className="w-3 h-3 text-rose-600 dark:text-rose-400" />
        )}
      </div>
      <pre
        className={cn(
          "flex-1 px-2 py-0.5 whitespace-pre-wrap break-words",
          textClass,
        )}
      >
        {line.content || " "}
      </pre>
    </div>
  );
}

export function FileDiffView({
  repoId,
  filePath,
  includeStaged,
  onBack,
  onOpenFile,
  isMobile = false,
}: FileDiffViewProps) {
  const { data: diffData, isLoading, error } = useFileDiff(repoId, filePath, includeStaged);

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
  const diffLines = diffData.diff ? parseDiff(diffData.diff) : [];

  return (
    <div className="flex flex-col h-full bg-background">
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
              <span className="text-green-500">+{diffData.additions}</span>
              <span className="text-red-500">-{diffData.deletions}</span>
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
        </div>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0">
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
            {diffLines.map((line, index) => (
              <DiffLineComponent
                key={index}
                line={line}
                showLineNumbers={!isMobile}
                onLineClick={
                  onOpenFile
                    ? (lineNum) => onOpenFile(filePath, lineNum)
                    : undefined
                }
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
