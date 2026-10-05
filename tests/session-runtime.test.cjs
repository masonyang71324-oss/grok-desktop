const test = require('node:test');
const assert = require('node:assert/strict');
const runtime = import('../src/session-runtime.mjs');

test('main runtime overrides stale stream identity and keeps finishing work busy', async () => {
  const { deriveSessionRuntime } = await runtime;
  const session = { sessionId: 'a', runtime: { status: 'running', turnId: 'old' } };
  const idle = deriveSessionRuntime({ session, tasks: [{ sessionId: 'a', status: 'idle' }] });
  assert.equal(idle.busy, false);
  assert.equal(idle.canStop, false);
  const finishing = deriveSessionRuntime({
    session,
    tasks: [{ sessionId: 'a', status: 'running', finishing: true }],
  });
  assert.equal(finishing.busy, true);
  assert.equal(finishing.canStop, false);
  assert.equal(finishing.canQueue, true);
  const cancelling = deriveSessionRuntime({
    session,
    tasks: [{ sessionId: 'a', status: 'running', turnId: 'new', cancelling: true }],
  });
  assert.equal(cancelling.canStop, false);
  assert.equal(cancelling.cancelling, true);
});

test('local send preparation stays visible and background work cannot be stopped as a foreground prompt', async () => {
  const { deriveSessionRuntime } = await runtime;
  const session = { sessionId: 'a', runtime: { status: 'idle' } };
  const preparing = deriveSessionRuntime({ session, tasks: [], pending: true });
  assert.equal(preparing.busy, true);
  assert.equal(preparing.canStop, true);
  assert.equal(preparing.canQueue, false);
  const background = deriveSessionRuntime({
    session,
    tasks: [{ sessionId: 'a', status: 'background', finishing: true }],
  });
  assert.equal(background.busy, true);
  assert.equal(background.canStop, false);
  assert.equal(background.canQueue, true);
  const preparingControl = deriveSessionRuntime({
    session,
    pending: true,
    tasks: [{ sessionId: 'a', status: 'background', finishing: true, cancelling: true }],
  });
  assert.equal(preparingControl.canStop, true, 'Local control preparation owns its stop action');
  assert.equal(
    preparingControl.cancelling,
    false,
    'The parent background cancellation does not cancel new local preparation',
  );
  assert.equal(
    deriveSessionRuntime({ session: null, tasks: [{ sessionId: 'b', status: 'running' }] }).busy,
    false,
  );
});

test('only explicitly advertised workflow controls can be sent through a busy background session', async () => {
  const { isWorkflowControl } = await runtime;
  const input = {
    runtime: { status: 'background', finishing: true },
    commands: [{ name: 'workflow' }],
  };
  for (const operation of ['pause', 'resume', 'stop'])
    assert.equal(isWorkflowControl({ ...input, text: `/workflow ${operation} example` }), true);
  for (const text of [
    'ordinary message',
    '/workflow run example',
    '/workflow stop example\nthen edit',
  ])
    assert.equal(isWorkflowControl({ ...input, text }), false);
  assert.equal(isWorkflowControl({ ...input, commands: [], text: '/workflow stop' }), false);
  assert.equal(isWorkflowControl({ ...input, attachments: [{}], text: '/workflow stop' }), false);
  assert.equal(
    isWorkflowControl({
      ...input,
      runtime: { status: 'running', finishing: false },
      text: '/workflow stop',
    }),
    false,
  );
});

test('automatic reconnect waits for a usable moment and spends only one attempt per target', async () => {
  const { createReconnectBudget } = await runtime;
  const budget = createReconnectBudget();
  budget.disconnected('a', { state: 'error', action: 'reconnect' });
  assert.equal(budget.take('a', { blocked: true }), false);
  assert.equal(budget.take('a', { enabled: false }), false);
  assert.equal(budget.take('a', { trusted: false }), false);
  assert.equal(budget.take('b'), false);
  assert.equal(budget.take('a'), true);
  budget.disconnected('a', { state: 'error', action: 'reconnect' });
  budget.disconnected('a', { state: 'ready', action: 'reconnect' });
  budget.disconnected('a', { state: 'disconnected', action: 'reconnect' });
  assert.equal(budget.take('a'), false, 'Failure and ready events cannot make a reconnect loop');
  budget.disconnected('b', { state: 'error', action: 'reconnect' });
  assert.equal(budget.take('b'), true);
  budget.rearm('a');
  budget.disconnected('a', { state: 'error', action: 'reconnect' });
  assert.equal(budget.take('a'), true, 'An explicit user action can rearm the selected target');
});

test('authentication, setup, quota, intentional sleeps and routine readiness do not request recovery', async () => {
  const { createReconnectBudget } = await runtime;
  for (const event of [
    { state: 'error', action: 'login' },
    { state: 'error', action: 'settings' },
    { state: 'error', action: 'usage' },
    { state: 'sleeping', action: 'retry' },
    { state: 'ready', action: 'retry' },
    { state: 'connecting', action: 'retry' },
  ]) {
    const budget = createReconnectBudget();
    budget.disconnected('catalog', { state: 'error', action: 'reconnect' });
    if (['ready', 'connecting'].includes(event.state)) budget.rearm('catalog');
    budget.disconnected('catalog', event);
    assert.equal(budget.take('catalog'), false);
  }
});
