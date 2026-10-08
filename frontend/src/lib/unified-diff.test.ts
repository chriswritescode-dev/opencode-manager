import { describe, expect, it } from 'vitest';
import { parseDiffLines, splitDiffHunks, splitUnifiedDiffByFile } from '@opencode-manager/shared/utils';

const DIFF = [
  'diff --git a/src/app.ts b/src/app.ts',
  'index 1111111..2222222 100644',
  '--- a/src/app.ts',
  '+++ b/src/app.ts',
  '@@ -1,3 +1,4 @@',
  ' const a = 1;',
  '-const b = 2;',
  '+const b = 3;',
  '+const c = 4;',
  '@@ -10,2 +11,2 @@',
  ' const d = 5;',
  '-const e = 6;',
  '+const e = 7;',
].join('\n');

describe('parseDiffLines', () => {
  it('classifies headers, hunks, additions, removals and context', () => {
    const lines = parseDiffLines(DIFF);

    expect(lines.map((line) => line.type)).toEqual([
      'header',
      'header',
      'header',
      'header',
      'hunk',
      'context',
      'remove',
      'add',
      'add',
      'hunk',
      'context',
      'remove',
      'add',
    ]);
    expect(lines[0]).toEqual({ type: 'header', content: 'diff --git a/src/app.ts b/src/app.ts' });
  });

  it('tracks old and new line numbers across hunks', () => {
    const lines = parseDiffLines(DIFF);

    expect(lines[5]).toMatchObject({ type: 'context', content: 'const a = 1;', oldLineNumber: 1, newLineNumber: 1 });
    expect(lines[6]).toMatchObject({ type: 'remove', content: 'const b = 2;', oldLineNumber: 2 });
    expect(lines[7]).toMatchObject({ type: 'add', content: 'const b = 3;', newLineNumber: 2 });
    expect(lines[10]).toMatchObject({ type: 'context', content: 'const d = 5;', oldLineNumber: 10, newLineNumber: 11 });
  });

  it('returns an empty list for an empty diff', () => {
    expect(parseDiffLines('')).toEqual([{ type: 'context', content: '', oldLineNumber: 0, newLineNumber: 0 }]);
  });

  it('treats ++/-- lines inside a hunk as additions and removals', () => {
    const lines = parseDiffLines('@@ -1,2 +1,2 @@\n---counter;\n+++counter;\n next();');

    expect(lines.map((line) => line.type)).toEqual(['hunk', 'remove', 'add', 'context']);
    expect(lines[1]).toMatchObject({ type: 'remove', content: '--counter;', oldLineNumber: 1 });
    expect(lines[2]).toMatchObject({ type: 'add', content: '++counter;', newLineNumber: 1 });
    expect(lines[3]).toMatchObject({ type: 'context', content: 'next();', oldLineNumber: 2, newLineNumber: 2 });
  });

  it('treats removed Markdown delimiter lines as removals', () => {
    const lines = parseDiffLines('@@ -1,3 +1,2 @@\n----\n title: x\n body');

    expect(lines.map((line) => line.type)).toEqual(['hunk', 'remove', 'context', 'context']);
    expect(lines[1]).toMatchObject({ type: 'remove', content: '---', oldLineNumber: 1 });
  });

  it('still recognizes real file headers before a hunk', () => {
    const patch = [
      'Index: docs/a.md',
      '===================================================================',
      '--- docs/a.md',
      '+++ docs/a.md',
      '@@ -1,1 +1,1 @@',
      '-a',
      '+b',
    ].join('\n');
    const lines = parseDiffLines(patch);

    expect(lines.map((line) => line.type)).toEqual(['header', 'header', 'hunk', 'remove', 'add']);
    expect(lines[0]).toMatchObject({ type: 'header', content: '--- docs/a.md' });
    expect(lines[1]).toMatchObject({ type: 'header', content: '+++ docs/a.md' });
    expect(lines[3]).toMatchObject({ type: 'remove', content: 'a', oldLineNumber: 1 });
    expect(lines[4]).toMatchObject({ type: 'add', content: 'b', newLineNumber: 1 });
  });
});

describe('splitDiffHunks', () => {
  it('returns one entry per hunk with the header line and body', () => {
    const hunks = splitDiffHunks(DIFF);

    expect(hunks).toHaveLength(2);
    expect(hunks[0].header).toBe('@@ -1,3 +1,4 @@');
    expect(hunks[0].text).toBe(
      ['@@ -1,3 +1,4 @@', ' const a = 1;', '-const b = 2;', '+const b = 3;', '+const c = 4;'].join('\n'),
    );
    expect(hunks[1].header).toBe('@@ -10,2 +11,2 @@');
    expect(hunks[1].text).toContain('-const e = 6;');
  });

  it('excludes lines before the first hunk', () => {
    const [first] = splitDiffHunks(DIFF);

    expect(first.text.startsWith('@@')).toBe(true);
    expect(first.text).not.toContain('diff --git');
    expect(first.text).not.toContain('--- a/src/app.ts');
  });

  it('returns an empty list for a binary patch with no hunk', () => {
    expect(splitDiffHunks('diff --git a/img.png b/img.png\nBinary files a/img.png and b/img.png differ')).toEqual([]);
  });

  it('returns an empty list for an empty patch', () => {
    expect(splitDiffHunks('')).toEqual([]);
  });
});

describe('splitUnifiedDiffByFile', () => {
  it('splits a modified file and counts additions and removals', () => {
    const result = splitUnifiedDiffByFile(DIFF);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ file: 'src/app.ts', status: 'modified', additions: 3, deletions: 2 });
    expect(result[0]!.patch.startsWith('diff --git a/src/app.ts b/src/app.ts')).toBe(true);
  });

  it('reads an added file from the new side', () => {
    const diff = [
      'diff --git a/src/new.ts b/src/new.ts',
      'new file mode 100644',
      'index 0000000..1111111',
      '--- /dev/null',
      '+++ b/src/new.ts',
      '@@ -0,0 +1,2 @@',
      '+one',
      '+two',
    ].join('\n');

    const [file] = splitUnifiedDiffByFile(diff);

    expect(file).toMatchObject({ file: 'src/new.ts', status: 'added', additions: 2, deletions: 0 });
  });

  it('reads a deleted file from the old side', () => {
    const diff = [
      'diff --git a/src/old.ts b/src/old.ts',
      'deleted file mode 100644',
      'index 1111111..0000000',
      '--- a/src/old.ts',
      '+++ /dev/null',
      '@@ -1,2 +0,0 @@',
      '-one',
      '-two',
    ].join('\n');

    const [file] = splitUnifiedDiffByFile(diff);

    expect(file).toMatchObject({ file: 'src/old.ts', status: 'deleted', additions: 0, deletions: 2 });
  });

  it('reads a renamed file with no content changes', () => {
    const diff = [
      'diff --git a/src/old.ts b/src/new.ts',
      'similarity index 100%',
      'rename from src/old.ts',
      'rename to src/new.ts',
    ].join('\n');

    const [file] = splitUnifiedDiffByFile(diff);

    expect(file).toMatchObject({ file: 'src/new.ts', status: 'modified', additions: 0, deletions: 0 });
  });

  it('keeps a binary block with no hunks', () => {
    const diff = [
      'diff --git a/assets/logo.png b/assets/logo.png',
      'index 1111111..2222222 100644',
      'Binary files a/assets/logo.png and b/assets/logo.png differ',
    ].join('\n');

    const [file] = splitUnifiedDiffByFile(diff);

    expect(file).toMatchObject({ file: 'assets/logo.png', status: 'modified' });
    expect(file!.patch).not.toContain('@@');
  });

  it('splits multiple files', () => {
    const diff = [
      DIFF,
      '',
      'diff --git a/src/other.ts b/src/other.ts',
      '--- a/src/other.ts',
      '+++ b/src/other.ts',
      '@@ -1 +1 @@',
      '-a',
      '+b',
    ].join('\n');

    expect(splitUnifiedDiffByFile(diff).map((entry) => entry.file)).toEqual(['src/app.ts', 'src/other.ts']);
  });

  it('parses a path containing a space with the trailing tab git appends', () => {
    const diff = [
      'diff --git a/my file.txt b/my file.txt',
      'index 5626abf..f719efd 100644',
      '--- a/my file.txt\t',
      '+++ b/my file.txt\t',
      '@@ -1 +1 @@',
      '-one',
      '+two',
    ].join('\n');

    const [file] = splitUnifiedDiffByFile(diff);

    expect(file).toMatchObject({ file: 'my file.txt', status: 'modified' });
  });

  it('decodes a C-quoted octal UTF-8 path', () => {
    const diff = [
      'diff --git "a/\\303\\251.txt" "b/\\303\\251.txt"',
      'index 587be6b..ccc9bd6 100644',
      '--- "a/\\303\\251.txt"',
      '+++ "b/\\303\\251.txt"',
      '@@ -1 +1 @@',
      '-x',
      '+xx',
    ].join('\n');

    const [file] = splitUnifiedDiffByFile(diff);

    expect(file).toMatchObject({ file: 'é.txt', status: 'modified' });
  });

  it('decodes a quoted rename target', () => {
    const diff = [
      'diff --git "a/\\303\\251.txt" "b/\\303\\251 renamed.txt"',
      'similarity index 100%',
      'rename from "\\303\\251.txt"',
      'rename to "\\303\\251 renamed.txt"',
    ].join('\n');

    const [file] = splitUnifiedDiffByFile(diff);

    expect(file).toMatchObject({ file: 'é renamed.txt', status: 'modified' });
  });

  it('decodes a quoted path in the header fallback', () => {
    const diff = [
      'diff --git "a/\\303\\251.bin" "b/\\303\\251.bin"',
      'index 1111111..2222222 100644',
      'Binary files "a/\\303\\251.bin" and "b/\\303\\251.bin" differ',
    ].join('\n');

    const [file] = splitUnifiedDiffByFile(diff);

    expect(file).toMatchObject({ file: 'é.bin', status: 'modified' });
  });

  it('decodes a quoted header path when only the new side is quoted', () => {
    const diff = [
      'diff --git a/plain.bin "b/\\303\\251.bin"',
      'index 1111111..2222222 100644',
      'Binary files a/plain.bin and "b/\\303\\251.bin" differ',
    ].join('\n');

    const [file] = splitUnifiedDiffByFile(diff);

    expect(file).toMatchObject({ file: 'é.bin', status: 'modified' });
  });

  it('returns an empty list for an empty diff', () => {
    expect(splitUnifiedDiffByFile('')).toEqual([]);
  });
});
