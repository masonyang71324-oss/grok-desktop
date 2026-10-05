// ConPTY owns native threads. Keep them outside the desktop main process and let
// process exit release them when the shell exits, including on older Windows.
let terminal;
let pendingExit;
const pendingMessages = [];
const parent = process.parentPort;
function deliver(message) {
  if (message.type === 'input') terminal.write(message.data);
  else if (message.type === 'resize') {
    try {
      terminal.resize(message.cols, message.rows);
    } catch {
      /* Shell can exit between resize and delivery. */
    }
  }
}
parent.on('message', async ({ data: message }) => {
  if (message.type === 'start') {
    try {
      await require('./owned-process.cjs').superviseUtility();
      terminal = require('node-pty').spawn(message.shell, message.args, message.options);
      terminal.onData((data) => parent.postMessage({ type: 'data', data }));
      terminal.onExit(({ exitCode }) => {
        pendingExit = 0;
        parent.postMessage({ type: 'exit', exitCode });
      });
      for (const message of pendingMessages.splice(0)) deliver(message);
    } catch (error) {
      pendingExit = 1;
      parent.postMessage({ type: 'error', message: error.message });
    }
  } else if (message.type === 'exit-ack' && pendingExit !== undefined) {
    // Wait until the parent receives the final output/status before releasing ConPTY threads.
    process.exit(pendingExit);
  } else if (message.type === 'input' || message.type === 'resize') {
    if (terminal) deliver(message);
    else if (pendingExit === undefined) pendingMessages.push(message);
  }
});
