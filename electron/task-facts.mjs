export function commandFromInput(input) {
  if (typeof input !== 'string') return '';
  const text = input.trim();
  if (!text.startsWith('{')) return text;
  try {
    const value = JSON.parse(text);
    return (
      [value.command, value.cmd, value.shell_command].find((item) => typeof item === 'string') || ''
    );
  } catch {
    return '';
  }
}

export function commandParts(command) {
  const parts = [];
  let ambiguousExit = false;
  let start = 0;
  let quote = '';
  for (let index = 0; index < command.length; index += 1) {
    const char = command[index];
    if (quote) {
      if (char === '\\' || char === '`') index += 1;
      else if (char === quote) quote = '';
    } else if (char === '"' || char === "'") quote = char;
    else if (
      char === ';' ||
      char === '\n' ||
      command.slice(index, index + 2) === '&&' ||
      command.slice(index, index + 2) === '||'
    ) {
      if (char !== '&') ambiguousExit = true;
      parts.push(command.slice(start, index));
      if (char === '&' || char === '|') index += 1;
      start = index + 1;
    } else if (char === '|' || (char === '&' && command.slice(start, index).trim())) {
      ambiguousExit = true;
    }
  }
  parts.push(command.slice(start));
  return { parts, ambiguousExit };
}

export function isValidationCommand(command) {
  return commandParts(command).parts.some((part) => {
    const value = part
      .trim()
      .replace(/^&\s+/, '')
      .replace(/^(?:[A-Za-z_]\w*=\S+\s+)+/, '');
    return (
      /^(?:npm|pnpm|yarn|bun)(?:\.cmd)?\s+(?:run\s+)?(?:test|lint|build|typecheck)(?::[\w-]+)?(?:\s|$)/i.test(
        value,
      ) ||
      /^(?:npx\s+(?:--yes\s+)?|pnpm\s+exec\s+)?(?:vitest|jest|eslint|tsc)(?:\.cmd)?(?:\s|$)/i.test(
        value,
      ) ||
      /^(?:npx\s+)?(?:playwright\s+test|prettier\s+[^\n]*--check)(?:\s|$)/i.test(value) ||
      /^node(?:\.exe)?\s+--test(?:\s|$)/i.test(value) ||
      /^(?:pytest|python(?:3|\.exe)?\s+-m\s+(?:pytest|unittest))(?:\s|$)/i.test(value) ||
      /^(?:cargo\s+(?:test|build|clippy)|go\s+(?:test|build|vet)|dotnet\s+(?:test|build)|ruff\s+check)(?:\s|$)/i.test(
        value,
      )
    );
  });
}

export function structuredExitCode(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  for (const key of ['exitCode', 'exit_code', 'exitStatus', 'exit_status']) {
    if (Number.isInteger(value[key])) return value[key];
  }
  for (const key of ['result', 'output', 'process']) {
    const nested = structuredExitCode(value[key]);
    if (nested !== null) return nested;
  }
  return null;
}

export function collectToolFacts(rows) {
  const tools = rows.filter((row) => row.kind === 'tool');
  const verification = { count: 0, passed: 0, failed: 0, unknown: 0 };
  for (const row of tools) {
    const command = commandFromInput(row.input);
    if (row.toolKind !== 'execute' || !isValidationCommand(command)) continue;
    const exitCode = commandParts(command).ambiguousExit ? null : structuredExitCode(row.rawOutput);
    verification.count += 1;
    verification[exitCode === null ? 'unknown' : exitCode === 0 ? 'passed' : 'failed'] += 1;
  }
  return {
    toolCount: tools.length,
    completedToolCount: tools.filter((row) => row.status === 'completed').length,
    failedToolCount: tools.filter((row) => row.status === 'failed').length,
    unfinishedToolCount: tools.filter(
      (row) => row.status !== 'completed' && row.status !== 'failed',
    ).length,
    verification,
  };
}
