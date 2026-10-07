export interface DiffLine {
  type: "add" | "remove" | "context" | "header" | "hunk";
  content: string;
  oldLineNumber?: number;
  newLineNumber?: number;
}

export interface DiffHunk {
  header: string;
  text: string;
}

export function parseDiffLines(diff: string): DiffLine[] {
  const lines = diff.split("\n");
  const result: DiffLine[] = [];
  let oldLine = 0;
  let newLine = 0;
  let oldRemaining = 0;
  let newRemaining = 0;
  let inHunk = false;

  for (const line of lines) {
    if (
      line.startsWith("diff --git") ||
      line.startsWith("index ") ||
      line.startsWith("Index:") ||
      line.startsWith("===")
    ) {
      inHunk = false;
      if (line.startsWith("diff --git") || line.startsWith("index ")) {
        result.push({ type: "header", content: line });
      }
      continue;
    }

    if (line.startsWith("@@")) {
      const match = line.match(/@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
      if (match) {
        oldLine = parseInt(match[1]!, 10);
        newLine = parseInt(match[3]!, 10);
        oldRemaining = match[2] === undefined ? 1 : parseInt(match[2], 10);
        newRemaining = match[4] === undefined ? 1 : parseInt(match[4], 10);
      }
      inHunk = true;
      result.push({ type: "hunk", content: line });
      continue;
    }

    if (!inHunk && (line.startsWith("---") || line.startsWith("+++"))) {
      result.push({ type: "header", content: line });
      continue;
    }

    if (line.startsWith("+")) {
      result.push({
        type: "add",
        content: line.substring(1),
        newLineNumber: newLine,
      });
      newLine++;
      newRemaining--;
    } else if (line.startsWith("-")) {
      result.push({
        type: "remove",
        content: line.substring(1),
        oldLineNumber: oldLine,
      });
      oldLine++;
      oldRemaining--;
    } else if (line.startsWith(" ") || line === "") {
      result.push({
        type: "context",
        content: line.substring(1) || "",
        oldLineNumber: oldLine,
        newLineNumber: newLine,
      });
      oldLine++;
      newLine++;
      oldRemaining--;
      newRemaining--;
    } else {
      continue;
    }

    if (inHunk && oldRemaining <= 0 && newRemaining <= 0) {
      inHunk = false;
    }
  }

  return result;
}

export function splitDiffHunks(patch: string): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  let current: string[] | null = null;

  for (const line of patch.split("\n")) {
    if (line.startsWith("@@")) {
      if (current) {
        hunks.push(toHunk(current));
      }
      current = [line];
    } else if (current) {
      current.push(line);
    }
  }

  if (current) {
    hunks.push(toHunk(current));
  }

  return hunks;
}

function toHunk(lines: string[]): DiffHunk {
  return { header: lines[0]!, text: lines.join("\n") };
}
