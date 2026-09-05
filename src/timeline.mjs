let sequence = 0;
export function contentText(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(contentText).filter(Boolean).join('\n');
  if (typeof value !== 'object') return String(value);
  if (value.type === 'diff')
    return `${value.path || '文件变更'}\n${value.oldText ? `- ${value.oldText}\n` : ''}+ ${value.newText || ''}`;
  if (typeof value.text === 'string') return value.text;
  if (value.content != null) return contentText(value.content);
  if (value.resource != null) return contentText(value.resource);
  return JSON.stringify(value, null, 2);
}

export function toolContent(value) {
  if (value == null) return [];
  if (Array.isArray(value)) return value.flatMap(toolContent);
  if (typeof value === 'object') {
    if (value.type === 'diff')
      return [
        {
          type: 'diff',
          path: value.path || '',
          oldText: value.oldText ?? null,
          newText: value.newText ?? '',
        },
      ];
    if (value.content != null) return toolContent(value.content);
    if (value.resource != null) return toolContent(value.resource);
  }
  const text = contentText(value);
  return text ? [{ type: 'text', text }] : [];
}

export function appendUpdate(rows, update, turnId = 'history') {
  const type = update.sessionUpdate;
  const kinds = {
    agent_message_chunk: 'assistant',
    agent_thought_chunk: 'thought',
    user_message_chunk: 'user',
  };
  if (kinds[type]) {
    const kind = kinds[type];
    const text = contentText(update.content);
    if (!text) return rows;
    const last = rows[rows.length - 1];
    if (last && last.kind === kind && last.turnId === turnId && last.streaming)
      return [...rows.slice(0, -1), { ...last, text: last.text + text }];
    return [...rows, { id: `row-${++sequence}`, kind, text, turnId, streaming: true }];
  }
  if (type === 'tool_call' || type === 'tool_call_update') {
    const index = rows.findIndex(
      (row) => row.kind === 'tool' && row.toolCallId === update.toolCallId && row.turnId === turnId,
    );
    const old = index >= 0 ? rows[index] : {};
    const row = {
      id: old.id || `row-${++sequence}`,
      kind: 'tool',
      turnId,
      toolCallId: update.toolCallId,
      title: update.title || old.title || '',
      status: update.status || old.status || 'pending',
      text:
        update.content != null
          ? contentText(update.content)
          : update.rawOutput != null
            ? contentText(update.rawOutput)
            : old.text || '',
      toolContent:
        update.content != null
          ? toolContent(update.content)
          : update.rawOutput != null
            ? toolContent(update.rawOutput)
            : old.toolContent || [],
      input: update.rawInput != null ? contentText(update.rawInput) : old.input || '',
      locations: update.locations || old.locations || [],
      streaming: false,
    };
    if (index < 0) return [...rows, row];
    return rows.map((value, i) => (i === index ? row : value));
  }
  return rows;
}

export function finalizeTurn(rows, turnId, failed = false) {
  return rows.map((row) =>
    row.turnId === turnId
      ? {
          ...row,
          streaming: false,
          ...(row.kind === 'tool' && ['pending', 'in_progress'].includes(row.status)
            ? { status: failed ? 'interrupted' : 'finished' }
            : {}),
        }
      : row,
  );
}

export function fromReplay(updates, sessionId) {
  let rows = [];
  let turn = 0;
  let previousType = '';
  for (const update of updates || []) {
    if (update.sessionUpdate === 'user_message_chunk' && previousType !== 'user_message_chunk') {
      rows = finalizeTurn(rows, `${sessionId}:history:${turn}`);
      turn += 1;
    }
    rows = appendUpdate(rows, update, `${sessionId}:history:${turn}`);
    previousType = update.sessionUpdate;
  }
  return rows.map((row) => ({ ...row, streaming: false }));
}

export function createFrameBuffer(
  deliver,
  schedule = requestAnimationFrame,
  cancel = cancelAnimationFrame,
) {
  let queue = [];
  let handle = null;
  const flush = () => {
    if (handle !== null) cancel(handle);
    handle = null;
    if (queue.length) {
      const batch = queue;
      queue = [];
      deliver(batch);
    }
  };
  return {
    push(item) {
      queue.push(item);
      if (handle === null) handle = schedule(flush);
    },
    flush,
    dispose() {
      if (handle !== null) cancel(handle);
      handle = null;
      queue = [];
    },
  };
}
