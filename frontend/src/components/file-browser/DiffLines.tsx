import { Plus, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import { parseDiffLines, type DiffLine } from "@opencode-manager/shared/utils";

export function DiffLineRow({
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
      <div className="px-4 py-1 bg-muted/50 text-muted-foreground text-xs font-mono break-all border-b border-border/30">
        {line.content}
      </div>
    );
  }

  if (line.type === "hunk") {
    return (
      <div className="px-4 py-1 bg-accent/20 text-accent-foreground text-xs font-mono break-all border-b border-border/20">
        {line.content}
      </div>
    );
  }

  const bgClass =
    line.type === "add"
      ? "bg-diff-add/10"
      : line.type === "remove"
        ? "bg-diff-delete/10"
        : "";

  const textClass =
    line.type === "add"
      ? "text-diff-add"
      : line.type === "remove"
        ? "text-diff-delete"
        : "text-foreground";

  const lineNumber = line.newLineNumber ?? line.oldLineNumber;
  const isClickable = onLineClick && lineNumber !== undefined;

  return (
    <div
      className={cn(
        "flex font-mono text-sm border-l-2 transition-colors min-w-0",
        bgClass,
        line.type === "add" && "border-l-diff-add",
        line.type === "remove" && "border-l-diff-delete",
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
          <Plus className="w-3 h-3 text-diff-add" />
        )}
        {line.type === "remove" && (
          <Minus className="w-3 h-3 text-diff-delete" />
        )}
      </div>
      <pre
        className={cn(
          "flex-1 min-w-0 px-2 py-0.5 whitespace-pre-wrap break-words overflow-hidden",
          textClass,
        )}
      >
        {line.content || " "}
      </pre>
    </div>
  );
}

export function DiffLines({
  diff,
  showLineNumbers = true,
  onLineClick,
}: {
  diff: string;
  showLineNumbers?: boolean;
  onLineClick?: (line: number) => void;
}) {
  return (
    <>
      {parseDiffLines(diff).map((line, index) => (
        <DiffLineRow
          key={index}
          line={line}
          showLineNumbers={showLineNumbers}
          onLineClick={onLineClick}
        />
      ))}
    </>
  );
}
