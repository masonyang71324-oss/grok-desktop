// ConPTY owns native threads. Keep them outside the desktop main process and let
// process exit release them when the shell exits, including on older Windows.
let terminal;
process.on('message', (message) => {
  if (message.type === 'start') {
    try {
      terminal = require('node-pty').spawn(message.shell, message.args, message.options);
      terminal.onData((data) => process.send?.({ type: 'data', data }));
      terminal.onExit(({ exitCode }) =>
        process.send?.({ type: 'exit', exitCode }, () => process.exit(0)),
      );
    } catch (error) {
      process.send?.({ type: 'error', message: error.message }, () => process.exit(1));
    }
  } else if (message.type === 'input') terminal?.write(message.data);
  else if (message.type === 'resize') {
    try {
      terminal?.resize(message.cols, message.rows);
    } catch {
      /* Shell can exit between resize and delivery. */
    }
  }
});
