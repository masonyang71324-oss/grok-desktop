import {
  commandFromInput,
  commandParts,
  isValidationCommand,
  structuredExitCode,
  collectToolFacts,
} from '../electron/task-facts.mjs';
const ACTIVE_TOOL_STATUSES = new Set(['pending', 'in_progress']);
const FILE_LIST_LIMIT = 6;

function currentRows(rows, turnId) {
  return turnId ? rows.filter((row) => row.turnId === turnId) : [];
}

export function deriveTaskActivity({
  rows,
  turnId,
  waitingApproval,
  pending,
  cancelling,
  background,
  finishing,
}) {
  const current = currentRows(rows, turnId);
  const tools = current.filter((row) => row.kind === 'tool');
  const base = { toolCount: tools.length, detail: '' };
  if (cancelling) return { ...base, phase: 'cancelling' };
  if (waitingApproval) return { ...base, phase: 'waiting' };
  if (pending) return { ...base, phase: 'preparing' };
  if (finishing && !background) return { ...base, phase: 'finalizing' };
  const active = tools.findLast((row) => ACTIVE_TOOL_STATUSES.has(row.status));
  if (active) {
    const kinds = { read: 'reading', edit: 'editing', search: 'searching' };
    const phase =
      kinds[active.toolKind] ||
      (active.toolKind === 'execute'
        ? isValidationCommand(commandFromInput(active.input))
          ? 'verifying'
          : 'executing'
        : 'working');
    return { ...base, phase, detail: active.title || '' };
  }
  const latest = current.findLast(
    (row) => row.streaming && (row.kind === 'assistant' || row.kind === 'thought'),
  );
  if (latest) return { ...base, phase: latest.kind === 'assistant' ? 'answering' : 'thinking' };
  return { ...base, phase: background ? 'background' : 'working' };
}

export function elapsedMilliseconds(startedAt, end = Date.now()) {
  const start = typeof startedAt === 'string' ? Date.parse(startedAt) : NaN;
  const finish = typeof end === 'string' ? Date.parse(end) : end;
  return Number.isFinite(start) && Number.isFinite(finish) && finish >= start
    ? finish - start
    : null;
}

export function formatElapsed(milliseconds) {
  const seconds = Math.floor(milliseconds / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds / 60) % 60;
  const remainder = String(seconds % 60).padStart(2, '0');
  return hours
    ? `${hours}:${String(minutes).padStart(2, '0')}:${remainder}`
    : `${minutes}:${remainder}`;
}

export function buildTaskOutcome(result, rows, checkpoint) {
  const tools = currentRows(rows, result.turnId).filter((row) => row.kind === 'tool');
  const facts = result.facts || collectToolFacts(tools);
  const verificationItems = tools.flatMap((row) => {
    const command = commandFromInput(row.input);
    if (row.toolKind !== 'execute' || !isValidationCommand(command)) return [];
    const exitCode = commandParts(command).ambiguousExit ? null : structuredExitCode(row.rawOutput);
    return [
      {
        id: row.id,
        command,
        exitCode,
        status: exitCode === null ? 'unknown' : exitCode === 0 ? 'passed' : 'failed',
      },
    ];
  });
  const matches =
    checkpoint?.turnId === result.turnId &&
    (!result.checkpointId || checkpoint.id === result.checkpointId);
  const ready = !!matches && checkpoint.status === 'ready';
  const files = ready ? checkpoint.files : [];
  const skippedCount =
    ready && Array.isArray(checkpoint.skipped) ? checkpoint.skipped.length : null;
  return {
    status: result.status,
    toolCount: facts.toolCount,
    completedToolCount: facts.completedToolCount,
    failedToolCount: facts.failedToolCount,
    unfinishedToolCount: facts.unfinishedToolCount,
    verification: {
      ...facts.verification,
      items: verificationItems,
    },
    checkpoint: {
      ready,
      cwd: matches ? checkpoint.cwd : '',
      fileCount: ready ? files.length : null,
      visibleFiles: files.slice(0, FILE_LIST_LIMIT),
      hiddenFileCount: Math.max(0, files.length - FILE_LIST_LIMIT),
      createdCount: ready ? files.filter((file) => file.status === 'created').length : null,
      modifiedCount: ready ? files.filter((file) => file.status === 'modified').length : null,
      deletedCount: ready ? files.filter((file) => file.status === 'deleted').length : null,
      skippedCount,
    },
  };
}
