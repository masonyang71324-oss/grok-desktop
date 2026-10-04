'use strict';
// Disposable MCP fixture. No external I/O, credentials, or system process termination.
const fs = require('node:fs');
const path = require('node:path');
const { fork } = require('node:child_process');
const readline = require('node:readline');
const [directory, role = 'server'] = process.argv.slice(2);
if (!directory || !path.isAbsolute(directory))
  throw new Error('An owned fixture directory is required');
const protocolFile = path.join(directory, 'mcp-protocol.jsonl');
const record = (fields) =>
  fs.appendFileSync(protocolFile, JSON.stringify({ pid: process.pid, ...fields }) + '\n');
record({ method: 'fixture/role-start', role, parentPid: process.ppid });
// Bounded safety fallback and file-based cleanup affect only these fresh fixture processes.
setTimeout(() => process.exit(0), 90000);
setInterval(() => {
  if (fs.existsSync(path.join(directory, 'stop-owned-fixture'))) process.exit(0);
}, 40);
if (role === 'leaf') {
  process.send({ leafPid: process.pid });
} else if (role === 'middle') {
  const child = fork(__filename, [directory, 'leaf'], {
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    windowsHide: true,
  });
  child.once('message', (value) => process.send({ middlePid: process.pid, ...value }));
} else {
  record({ method: 'fixture/server-start', parentPid: process.ppid });
  const reply = (id, result) =>
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
  const lines = readline.createInterface({ input: process.stdin });
  lines.on('line', (line) => {
    const request = JSON.parse(line);
    record({
      method: request.method,
      ...(request.method === 'tools/call' ? { tool: request.params?.name } : {}),
    });
    if (request.method === 'initialize')
      reply(request.id, {
        protocolVersion: request.params.protocolVersion,
        capabilities: { tools: {} },
        serverInfo: { name: 'owned-lifecycle-fixture', version: '1.0.0' },
      });
    else if (request.method === 'tools/list')
      reply(request.id, {
        tools: [
          {
            name: 'hold_owned_tree',
            description: 'Start only the disposable fixture wait descendants.',
            inputSchema: { type: 'object', properties: {}, additionalProperties: false },
            annotations: {
              readOnlyHint: false,
              destructiveHint: false,
              idempotentHint: false,
              openWorldHint: false,
            },
          },
        ],
      });
    else if (request.method === 'tools/call' && request.params.name === 'hold_owned_tree') {
      const child = fork(__filename, [directory, 'middle'], {
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
        windowsHide: true,
      });
      child.once('message', (value) => {
        fs.writeFileSync(
          path.join(directory, 'mcp-call-ready.json'),
          JSON.stringify({ serverPid: process.pid, serverParentPid: process.ppid, ...value }),
        );
        reply(request.id, {
          content: [{ type: 'text', text: 'The disposable fixture process tree is ready.' }],
        });
      });
    } else if (request.method === 'ping') reply(request.id, {});
    else if (request.id !== undefined)
      process.stdout.write(
        JSON.stringify({
          jsonrpc: '2.0',
          id: request.id,
          error: { code: -32601, message: 'Method not found' },
        }) + '\n',
      );
  });
  lines.on('close', () => record({ method: 'fixture/stdin-eof' }));
}
