function rowText(row) {
  const output = row.toolContent?.length
    ? row.toolContent
        .map((part) =>
          part.type === 'diff' ? `${part.path}\n${part.oldText || ''}\n${part.newText}` : part.text,
        )
        .join('\n')
    : row.text || '';
  return [
    row.title,
    row.input,
    output,
    ...(row.attachments || []).map((item) => item.name),
    ...(row.locations || []).map((item) => item.path),
  ]
    .filter(Boolean)
    .join('\n');
}

export function searchConversation(rows, query, turnError = '') {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [];
  const hits = [];
  const entries = rows.map((row) => ({
    text: rowText(row),
    target: { kind: 'row', rowId: row.id },
    rowKind: row.kind,
  }));
  if (turnError) entries.push({ text: turnError, target: { kind: 'error' }, rowKind: 'error' });
  for (const entry of entries) {
    const searchable = entry.text.toLocaleLowerCase();
    let offset = 0;
    while ((offset = searchable.indexOf(needle, offset)) !== -1) {
      const start = Math.max(0, offset - 40),
        end = Math.min(entry.text.length, offset + needle.length + 70);
      hits.push({
        target: entry.target,
        rowKind: entry.rowKind,
        offset,
        snippet: `${start ? '…' : ''}${entry.text.slice(start, end).replace(/\s+/g, ' ')}${end < entry.text.length ? '…' : ''}`,
      });
      offset += needle.length;
    }
  }
  return hits;
}

export function questionOutline(rows) {
  return rows
    .filter((row) => row.kind === 'user')
    .map((row) => ({
      title: (
        row.text.trim() || (row.attachments || []).map((item) => item.name).join('、')
      ).replace(/\s+/g, ' '),
      target: { kind: 'row', rowId: row.id },
    }))
    .filter((entry) => entry.title);
}
