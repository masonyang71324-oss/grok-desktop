const address = document.getElementById('address'),
  status = document.getElementById('status');
let current = { labels: {} },
  capturing = false;
function render(state) {
  current = state;
  if (document.activeElement !== address) address.value = state.url || '';
  address.setAttribute('aria-label', state.labels.address);
  document.title = state.title || 'Grok Preview';
  for (const button of document.querySelectorAll('[data-action]')) {
    const action = button.dataset.action;
    button.title = state.labels[action];
    if (['capture', 'external'].includes(action)) button.textContent = state.labels[action];
    button.disabled =
      action === 'back'
        ? !state.back
        : action === 'forward'
          ? !state.forward
          : action === 'capture'
            ? capturing || state.loading
            : false;
  }
  document.getElementById('open').textContent = state.labels.open;
  status.textContent = state.error || state.url || '';
  status.className = state.error ? 'error' : '';
}
async function run(action, url) {
  if (action === 'capture' && capturing) return;
  try {
    if (action === 'capture') {
      capturing = true;
      render(current);
    }
    const result = await window.preview.request({ action, url });
    if (!result.ok) throw new Error(result.error);
    if (action === 'capture') {
      status.textContent = current.labels.saved;
      status.className = '';
    } else if (result.data?.labels) render(result.data);
  } catch (error) {
    status.textContent = error.message;
    status.className = 'error';
  } finally {
    if (action === 'capture') capturing = false;
    const button = document.querySelector('[data-action=capture]');
    button.disabled = !!current.loading || capturing;
  }
}
document.getElementById('navigation').addEventListener('submit', (event) => {
  event.preventDefault();
  void run('navigate', address.value);
});
for (const button of document.querySelectorAll('[data-action]'))
  button.addEventListener('click', () => void run(button.dataset.action));
window.preview.onState(render);
void run('state');
