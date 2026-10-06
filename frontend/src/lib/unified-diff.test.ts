import { describe, expect, it } from 'vitest';
import { parseDiffLines, splitDiffHunks } from '@opencode-manager/shared/utils';

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
