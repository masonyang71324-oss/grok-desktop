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

function mergeAttachments(previous = [], incoming = []) {
  if (!incoming.length) return previous;
  const seen = new Set(previous.map((file) => file.path));
  return [...previous, ...incoming.filter((file) => !seen.has(file.path))];
}

function toolRow(old, update, turnId) {
  return {
    id: old.id || `row-${++sequence}`,
    kind: 'tool',
    turnId,
    toolCallId: update.toolCallId,
    toolKind: update.kind || old.toolKind,
    rawOutput: update.rawOutput != null ? update.rawOutput : old.rawOutput,
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
    const attachments = kind === 'user' ? update._desktopAttachments : undefined;
    if (!text && !attachments?.length) return rows;
    const last = rows[rows.length - 1];
    if (last && last.kind === kind && last.turnId === turnId && last.streaming)
      return [
        ...rows.slice(0, -1),
        {
          ...last,
          text: last.text + text,
          ...(attachments?.length
            ? { attachments: mergeAttachments(last.attachments, attachments) }
            : {}),
        },
      ];
    return [
      ...rows,
      {
        id: `row-${++sequence}`,
        kind,
        text,
        turnId,
        streaming: true,
        ...(attachments?.length ? { attachments } : {}),
      },
    ];
  }
  if (type === 'tool_call' || type === 'tool_call_update') {
    const index = rows.findIndex(
      (row) => row.kind === 'tool' && row.toolCallId === update.toolCallId && row.turnId === turnId,
    );
    const old = index >= 0 ? rows[index] : {};
    const row = toolRow(old, update, turnId);
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

// React publishes once per frame: copy the array once and retain every untouched row.
export function appendUpdates(rows, items) {
  let result = rows;
  let tools;
  const chunks = new Map();
  const kinds = {
    agent_message_chunk: 'assistant',
    agent_thought_chunk: 'thought',
    user_message_chunk: 'user',
  };
  for (const { update, turnId = 'history' } of items) {
    const kind = kinds[update.sessionUpdate];
    if (kind) {
      const text = contentText(update.content);
      const attachments = kind === 'user' ? update._desktopAttachments : undefined;
      if (!text && !attachments?.length) continue;
      if (result === rows) result = rows.slice();
      const last = result.at(-1);
      if (last && last.kind === kind && last.turnId === turnId && last.streaming) {
        let parts = chunks.get(result.length - 1);
        if (!parts) {
          result[result.length - 1] = { ...last };
          parts = [last.text];
          chunks.set(result.length - 1, parts);
        }
        parts.push(text);
        if (attachments?.length)
          result.at(-1).attachments = mergeAttachments(result.at(-1).attachments, attachments);
      } else {
        chunks.set(result.length, [text]);
        result.push({
          id: `row-${++sequence}`,
          kind,
          text: '',
          turnId,
          streaming: true,
          ...(attachments?.length ? { attachments } : {}),
        });
      }
    } else if (['tool_call', 'tool_call_update'].includes(update.sessionUpdate)) {
      if (result === rows) result = rows.slice();
      if (!tools) {
        tools = new Map();
        result.forEach((row, index) => {
          if (row.kind !== 'tool') return;
          if (!tools.has(row.turnId)) tools.set(row.turnId, new Map());
          tools.get(row.turnId).set(row.toolCallId, index);
        });
      }
      if (!tools.has(turnId)) tools.set(turnId, new Map());
      const scoped = tools.get(turnId);
      const index = scoped.get(update.toolCallId) ?? result.length;
      result[index] = toolRow(result[index] || {}, update, turnId);
      scoped.set(update.toolCallId, index);
    }
  }
  for (const [index, parts] of chunks) result[index].text = parts.join('');
  return result;
}

export function fromReplay(updates, sessionId, runtime) {
  const rows = [];
  const toolsByTurn = new Map();
  const openByTurn = new Map();
  const chunks = new Map();
  const kinds = {
    agent_message_chunk: 'assistant',
    agent_thought_chunk: 'thought',
    user_message_chunk: 'user',
  };
  const track = (turnId, index) => {
    if (!openByTurn.has(turnId)) openByTurn.set(turnId, new Set());
    openByTurn.get(turnId).add(index);
  };
  const finish = (turnId) => {
    for (const index of openByTurn.get(turnId) || []) {
      const row = rows[index];
      row.streaming = false;
      if (row.kind === 'tool' && ['pending', 'in_progress'].includes(row.status))
        row.status = 'finished';
    }
    openByTurn.delete(turnId);
  };
  let turn = 0;
  let previousType = '';
  let currentTurnId = `${sessionId}:history:0`;
  for (const [index, update] of (updates || []).entries()) {
    if (update.sessionUpdate === 'user_message_chunk' && previousType !== 'user_message_chunk') {
      finish(currentTurnId);
      turn += 1;
      currentTurnId = `${sessionId}:history:${turn}`;
    }
    const live =
      runtime?.turnId &&
      runtime.activeTurnStartIndex != null &&
      index >= runtime.activeTurnStartIndex;
    const tagged = typeof update._desktopTurnId === 'string' ? update._desktopTurnId : null;
    if (tagged) currentTurnId = tagged;
    const turnId = tagged || (live ? runtime.turnId : currentTurnId);
    const kind = kinds[update.sessionUpdate];
    if (kind) {
      const text = contentText(update.content);
      const attachments = kind === 'user' ? update._desktopAttachments : undefined;
      if (text || attachments?.length) {
        const last = rows.at(-1);
        if (last && last.kind === kind && last.turnId === turnId && last.streaming) {
          chunks.get(last).push(text);
          if (attachments?.length)
            last.attachments = mergeAttachments(last.attachments, attachments);
        } else {
          const row = {
            id: `row-${++sequence}`,
            kind,
            text: '',
            turnId,
            streaming: true,
            ...(attachments?.length ? { attachments } : {}),
          };
          track(turnId, rows.length);
          rows.push(row);
          chunks.set(row, [text]);
        }
      }
    } else if (['tool_call', 'tool_call_update'].includes(update.sessionUpdate)) {
      if (!toolsByTurn.has(turnId)) toolsByTurn.set(turnId, new Map());
      const tools = toolsByTurn.get(turnId);
      const index = tools.get(update.toolCallId) ?? rows.length;
      rows[index] = toolRow(rows[index] || {}, update, turnId);
      tools.set(update.toolCallId, index);
      if (['pending', 'in_progress'].includes(rows[index].status)) track(turnId, index);
    }
    previousType = update.sessionUpdate;
  }
  for (const row of rows) {
    if (chunks.has(row)) row.text = chunks.get(row).join('');
    if (row.turnId !== runtime?.turnId) row.streaming = false;
  }
  return rows;
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
