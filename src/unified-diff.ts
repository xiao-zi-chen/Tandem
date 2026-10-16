export interface DiffLine {
  index: number;
  line: string;
  type: 'hunk' | 'add' | 'remove' | 'context' | 'meta';
  old: string;
  next: string;
}

export interface SplitDiffRow {
  type: 'change' | 'context' | 'meta' | 'hunk';
  left?: DiffLine;
  right?: DiffLine;
  text?: string;
}

export function splitDiffRows(lines: DiffLine[]): SplitDiffRow[] {
  const rows: SplitDiffRow[] = [];
  let removed: DiffLine[] = [],
    added: DiffLine[] = [];
  const flush = () => {
    for (let index = 0; index < Math.max(removed.length, added.length); index++)
      rows.push({ type: 'change', left: removed[index], right: added[index] });
    removed = [];
    added = [];
  };
  for (const line of lines) {
    if (line.type === 'remove') {
      if (added.length) flush();
      removed.push(line);
    } else if (line.type === 'add') added.push(line);
    else {
      flush();
      rows.push(
        line.type === 'context'
          ? { type: 'context', left: line, right: line }
          : { type: line.type, text: line.line },
      );
    }
  }
  flush();
  return rows;
}

export function parseUnifiedDiff(text: string): DiffLine[] {
  const result: DiffLine[] = [];
  let oldNumber = 0;
  let newNumber = 0;
  let inHunk = false;
  const lines = text.split('\n');
  // The final newline terminates a record; it is not an extra source line.
  if (lines.at(-1) === '') lines.pop();
  for (const [index, line] of lines.entries()) {
    if (line.startsWith('diff --git ')) {
      inHunk = false;
      continue;
    }
    const hunk = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) {
      inHunk = true;
      oldNumber = Number(hunk[1]);
      newNumber = Number(hunk[2]);
      result.push({ index, line, type: 'hunk', old: '', next: '' });
      continue;
    }
    if (!inHunk && /^(index |--- |\+\+\+ )/.test(line)) continue;
    // Header-like content inside a hunk is still source code.
    const type = !inHunk
      ? 'meta'
      : line.startsWith('+')
        ? 'add'
        : line.startsWith('-')
          ? 'remove'
          : line.startsWith(' ')
            ? 'context'
            : 'meta';
    result.push({
      index,
      line: type === 'meta' ? line : line.slice(1),
      type,
      old: type === 'remove' || type === 'context' ? String(oldNumber++) : '',
      next: type === 'add' || type === 'context' ? String(newNumber++) : '',
    });
  }
  return result;
}
