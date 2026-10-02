// Display-only model: the caller always retains the exact original diff.
export function parseDiff(raw) {
  let before = null,
    after = /^(?:新文件 |New file )/.test(raw) ? 1 : null;
  const lines = raw.split('\n');
  if (lines.at(-1) === '') lines.pop();
  const rows = lines.map((source, id) => {
    const row = { id, source, text: source, kind: 'meta' };
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(source);
    if (hunk) {
      before = Number(hunk[1]);
      after = Number(hunk[2]);
      row.kind = 'hunk';
    } else if (source.startsWith('diff --git ')) {
      before = null;
      after = null;
    } else if (source.startsWith('+') && !source.startsWith('+++')) {
      row.kind = 'add';
      row.text = source.slice(1);
      if (after !== null) row.after = after++;
    } else if (source.startsWith('-') && !source.startsWith('---')) {
      row.kind = 'remove';
      row.text = source.slice(1);
      if (before !== null) row.before = before++;
    } else if (source.startsWith(' ') && before !== null && after !== null) {
      row.kind = 'context';
      row.text = source.slice(1);
      row.before = before++;
      row.after = after++;
    }
    return row;
  });
  return { raw, rows };
}

export function splitRows(rows) {
  const result = [];
  for (let i = 0; i < rows.length;) {
    const row = rows[i];
    if (row.kind === 'remove' || row.kind === 'add') {
      const left = [],
        right = [];
      while (i < rows.length && ['remove', 'add'].includes(rows[i].kind)) {
        (rows[i].kind === 'remove' ? left : right).push(rows[i++]);
      }
      for (let j = 0; j < Math.max(left.length, right.length); j++)
        result.push({ id: `${row.id}-${j}`, left: left[j], right: right[j] });
    } else {
      result.push({ id: String(row.id), left: row, right: row, shared: row.kind !== 'context' });
      i++;
    }
  }
  return result;
}

export function foldContext(rows, radius = 3, expanded = new Set()) {
  const result = [];
  for (let i = 0; i < rows.length;) {
    if (rows[i].kind !== 'context') {
      result.push(rows[i++]);
      continue;
    }
    let end = i;
    while (end < rows.length && rows[end].kind === 'context') end++;
    const count = end - i - radius * 2;
    if (count > 0 && !expanded.has(rows[i].id)) {
      result.push(
        ...rows.slice(i, i + radius),
        { kind: 'fold', id: rows[i].id, count, text: '', source: '' },
        ...rows.slice(end - radius, end),
      );
    } else result.push(...rows.slice(i, end));
    i = end;
  }
  return result;
}

export function wordParts(before, after) {
  // Token LCS preserves whitespace and works with CJK; very long lines avoid
  // a quadratic comparison and remain readable as an ordinary whole-line edit.
  const tokens = (text) =>
    text.match(
      /\s+|[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]|[\p{L}\p{N}_]+|[^\s]/gu,
    ) || [];
  const a = tokens(before),
    b = tokens(after);
  if (a.length * b.length > 40000)
    return {
      before: [{ text: before, changed: before !== after }],
      after: [{ text: after, changed: before !== after }],
    };
  const grid = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      grid[i][j] =
        a[i] === b[j] ? grid[i + 1][j + 1] + 1 : Math.max(grid[i + 1][j], grid[i][j + 1]);
  const left = [],
    right = [];
  const append = (parts, text, changed) => {
    if (parts.at(-1)?.changed === changed) parts.at(-1).text += text;
    else parts.push({ text, changed });
  };
  let i = 0,
    j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      append(left, a[i++], false);
      append(right, b[j++], false);
    } else if (i < a.length && (j === b.length || grid[i + 1][j] >= grid[i][j + 1]))
      append(left, a[i++], true);
    else append(right, b[j++], true);
  }
  return { before: left, after: right };
}
