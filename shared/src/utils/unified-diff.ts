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

export interface UnifiedFileDiff {
  file: string;
  status: "added" | "deleted" | "modified";
  patch: string;
  additions: number;
  deletions: number;
}

export function splitUnifiedDiffByFile(diff: string): UnifiedFileDiff[] {
  const blocks: string[][] = [];

  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) {
      blocks.push([line]);
    } else if (blocks.length > 0) {
      blocks[blocks.length - 1]!.push(line);
    }
  }

  return blocks.map((lines) => toUnifiedFileDiff(lines));
}

function toUnifiedFileDiff(lines: string[]): UnifiedFileDiff {
  const header = lines[0]!;
  const newPath = lines.find((line) => line.startsWith("+++ "));
  const oldPath = lines.find((line) => line.startsWith("--- "));
  const renameTo = lines.find((line) => line.startsWith("rename to "));
  let file = "";
  let status: UnifiedFileDiff["status"] = "modified";
  let additions = 0;
  let deletions = 0;

  if (newPath && newPath.slice(4) !== "/dev/null") {
    file = parseDiffPathToken(newPath.slice(4), "b/");
  } else if (oldPath && oldPath.slice(4) !== "/dev/null") {
    file = parseDiffPathToken(oldPath.slice(4), "a/");
  } else if (renameTo) {
    file = parseDiffPathToken(renameTo.slice("rename to ".length), "");
  } else {
    file = newPathFromDiffHeader(header);
  }

  for (const line of lines) {
    if (line.startsWith("new file mode")) {
      status = "added";
    } else if (line.startsWith("deleted file mode")) {
      status = "deleted";
    }

    if (line.startsWith("+++") || line.startsWith("---")) {
      continue;
    }

    if (line.startsWith("+")) {
      additions++;
    } else if (line.startsWith("-")) {
      deletions++;
    }
  }

  return { file, status, patch: lines.join("\n"), additions, deletions };
}

function stripDiffPathPrefix(path: string, prefix: string): string {
  return path.startsWith(prefix) ? path.slice(prefix.length) : path;
}

const GIT_C_ESCAPES: Record<string, number> = {
  a: 0x07,
  b: 0x08,
  f: 0x0c,
  n: 0x0a,
  r: 0x0d,
  t: 0x09,
  v: 0x0b,
  "\\": 0x5c,
  '"': 0x22,
};

function parseDiffPathToken(raw: string, prefix: string): string {
  const token = raw.startsWith('"') ? decodeGitQuotedPath(raw) : raw.split("\t")[0]!;
  return stripDiffPathPrefix(token, prefix);
}

function decodeGitQuotedPath(raw: string): string {
  const bytes: number[] = [];
  const encoder = new TextEncoder();
  let index = 1;

  while (index < raw.length) {
    const char = raw[index]!;
    if (char === '"') {
      break;
    }
    if (char === "\\") {
      const octal = /^[0-7]{1,3}/.exec(raw.slice(index + 1));
      if (octal) {
        bytes.push(parseInt(octal[0]!, 8) & 0xff);
        index += 1 + octal[0]!.length;
        continue;
      }
      const next = raw[index + 1];
      if (next === undefined) {
        break;
      }
      const escaped = GIT_C_ESCAPES[next];
      bytes.push(...(escaped === undefined ? encoder.encode(next) : [escaped]));
      index += 2;
      continue;
    }
    bytes.push(...encoder.encode(char));
    index += 1;
  }

  return new TextDecoder().decode(new Uint8Array(bytes));
}

function newPathFromDiffHeader(header: string): string {
  const rest = header.slice("diff --git ".length);

  if (rest.startsWith('"')) {
    const end = findClosingQuote(rest);
    if (end >= 0) {
      let index = end + 1;
      while (rest[index] === " ") {
        index += 1;
      }
      return parseDiffPathToken(rest.slice(index), "b/");
    }
  }

  const quoted = rest.indexOf(' "');
  if (quoted >= 0) {
    return parseDiffPathToken(rest.slice(quoted + 1), "b/");
  }

  const index = rest.lastIndexOf(" b/");
  return index >= 0 ? parseDiffPathToken(rest.slice(index + 1), "b/") : "";
}

function findClosingQuote(raw: string): number {
  for (let index = 1; index < raw.length; index += 1) {
    if (raw[index] === "\\") {
      index += 1;
      continue;
    }
    if (raw[index] === '"') {
      return index;
    }
  }
  return -1;
}
