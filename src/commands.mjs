export function buildCommand(command, values) {
  const name = command.name.replace(/^\//, '');
  const prefix = `/${name}`;
  const value = (key) => String(values[key] || '').trim();
  if (name === 'goal') {
    if (value('operation') && value('operation') !== 'set')
      return `${prefix} ${value('operation')}`;
    return `${prefix} ${value('objective')}${value('budget') ? ` --budget ${value('budget')}` : ''}`.trim();
  }
  if (name === 'workflow') {
    const operation = value('operation') || 'run';
    if (operation === 'runs') return `${prefix} runs`;
    if (operation !== 'run') return `${prefix} ${operation} ${value('name')}`.trim();
    return `${prefix} ${value('name')}${value('agentBudget') ? ` --agent-budget ${value('agentBudget')}` : ''}${value('effort') ? ` --effort ${value('effort')}` : ''}${value('argument') ? ` ${value('argument')}` : ''}`.trim();
  }
  return `${prefix}${value('argument') ? ` ${value('argument')}` : ''}`;
}
