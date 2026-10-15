'use strict';
// The real official reader, with a synthetic loopback-only model. All documents
// are generated fixtures; no login, real credentials, or paid inference is used.
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { deflateSync, crc32 } = require('node:zlib');
const JSZip = require('jszip');
const XLSX = require('xlsx');
const { GrokClient } = require('../electron/acp.cjs');
const exec = promisify(execFile);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(predicate, label, timeout = 60000) {
  const start = Date.now();
  while (!predicate()) {
    assert.ok(Date.now() - start < timeout, `Timed out: ${label}`);
    await delay(30);
  }
}
function largePng() {
  const width = 2560;
  const chunk = (type, value) => {
    const body = Buffer.concat([Buffer.from(type), value]);
    const length = Buffer.alloc(4),
      checksum = Buffer.alloc(4);
    length.writeUInt32BE(value.length);
    checksum.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, checksum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(width, 4);
  header[8] = 8;
  header[9] = 2;
  const pixels = Buffer.alloc((width * 3 + 1) * width, 128);
  for (let row = 0; row < width; row++) pixels[row * (width * 3 + 1)] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(pixels, { level: 0 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
function largePdf(marker) {
  // A real PDF image XObject with an uncompressed 2560-square RGB image, not
  // trailing padding. A text sentinel follows the image paint instruction.
  const image = Buffer.alloc(2560 * 2560 * 3, 128);
  const content = Buffer.from(
    `q 100 0 0 100 50 500 cm /Im1 Do Q\nBT /F1 12 Tf 50 450 Td (${marker}) Tj ET\n`,
  );
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> /XObject << /Im1 5 0 R >> >> /Contents 6 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    Buffer.concat([
      Buffer.from(
        `<< /Type /XObject /Subtype /Image /Width 2560 /Height 2560 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Length ${image.length} >>\nstream\n`,
      ),
      image,
      Buffer.from('\nendstream'),
    ]),
    Buffer.concat([
      Buffer.from(`<< /Length ${content.length} >>\nstream\n`),
      content,
      Buffer.from('endstream'),
    ]),
  ];
  const parts = [Buffer.from('%PDF-1.4\n% synthetic local fixture\n')];
  const offsets = [0];
  let length = parts[0].length;
  objects.forEach((object, index) => {
    offsets.push(length);
    const part = Buffer.concat([
      Buffer.from(`${index + 1} 0 obj\n`),
      Buffer.from(object),
      Buffer.from('\nendobj\n'),
    ]);
    parts.push(part);
    length += part.length;
  });
  parts.push(
    Buffer.from(
      `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets
        .slice(1)
        .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
        .join(
          '',
        )}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${length}\n%%EOF\n`,
    ),
  );
  return Buffer.concat(parts);
}
async function fixtures(cwd) {
  const pptMarker = '大文件末尾哨兵 LARGE_PPTX_END_20261015';
  const ppt = await JSZip.loadAsync(
    await fs.readFile(path.join(__dirname, '../tests/fixtures/documents/native/sample.pptx')),
  );
  const slide = await ppt.file('ppt/slides/slide1.xml').async('string');
  ppt.file(
    'ppt/slides/slide1.xml',
    slide
      .replace('维护费：25800元', `维护费：25800元 ${pptMarker}`)
      .replace(
        '</p:spTree>',
        '<p:pic><p:nvPicPr><p:cNvPr id="4" name="Synthetic large image"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rId2"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic></p:spTree>',
      ),
  );
  ppt.file(
    'ppt/slides/_rels/slide1.xml.rels',
    (await ppt.file('ppt/slides/_rels/slide1.xml.rels').async('string')).replace(
      '</Relationships>',
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/fixture.png"/></Relationships>',
    ),
  );
  ppt.file(
    '[Content_Types].xml',
    (await ppt.file('[Content_Types].xml').async('string')).replace(
      '</Types>',
      '<Default Extension="png" ContentType="image/png"/></Types>',
    ),
  );
  ppt.file('ppt/media/fixture.png', largePng(), { compression: 'STORE' });
  await fs.writeFile(
    path.join(cwd, 'large.pptx'),
    await ppt.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }),
  );
  const pdfMarker = 'LARGE_PDF_END_20261015';
  await fs.writeFile(path.join(cwd, 'large.pdf'), largePdf(pdfMarker));
  const docMarker = '原生文档哨兵 DOCX_END_20261015';
  const docx = await JSZip.loadAsync(
    await fs.readFile(path.join(__dirname, '../tests/fixtures/word/sample.docx')),
  );
  docx.file(
    'word/document.xml',
    (await docx.file('word/document.xml').async('string')).replace(
      '</w:body>',
      `<w:p><w:r><w:t>${docMarker}</w:t></w:r></w:p></w:body>`,
    ),
  );
  await fs.writeFile(
    path.join(cwd, 'small.docx'),
    await docx.generateAsync({ type: 'nodebuffer' }),
  );
  const sheetMarker = '原生表格哨兵 XLSX_END_20261015';
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([['合成数据', 25800], [sheetMarker]]),
    '试验',
  );
  await fs.writeFile(
    path.join(cwd, 'small.xlsx'),
    XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }),
  );
  return Promise.all(
    [
      ['large.pptx', pptMarker],
      ['large.pdf', pdfMarker],
      ['small.docx', docMarker],
      ['small.xlsx', sheetMarker],
    ].map(async ([file, marker]) => ({
      file,
      marker,
      fileSize: (await fs.stat(path.join(cwd, file))).size,
      args: {
        target_file: path.join(cwd, file),
        offset: 1,
        limit: 1000,
        ...(file.endsWith('.pdf') ? { format: 'text', pages: '1' } : {}),
      },
    })),
  );
}
async function main() {
  const executable = path.resolve(
    process.argv[2] || path.join(os.homedir(), '.grok', 'bin', 'grok.exe'),
  );
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'grok-large-documents-'));
  const dirs = Object.fromEntries(
    ['profile', 'home', 'roaming', 'local', 'tmp', 'cwd'].map((name) => [
      name,
      path.join(root, name),
    ]),
  );
  await Promise.all(Object.values(dirs).map((dir) => fs.mkdir(dir)));
  const stages = await fixtures(dirs.cwd);
  const report = {
    checkedAt: new Date().toISOString(),
    executable,
    scope:
      'Real official read_file with loopback synthetic model and synthetic documents; not a paid-model quality test',
    requests: [],
    blockedProxyRequests: [],
    permissions: [],
    stages: [],
    cleaned: false,
  };
  let stage,
    emitted = false,
    failure,
    client;
  const children = [];
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://127.0.0.1');
      if (url.hostname !== '127.0.0.1') {
        report.blockedProxyRequests.push({ method: request.method, host: url.hostname });
        response.writeHead(502);
        response.end('{}');
        return;
      }
      if (request.method === 'GET' && url.pathname.endsWith('/models')) {
        response.setHeader('Content-Type', 'application/json');
        response.end(
          JSON.stringify({
            object: 'list',
            data: [{ id: 'local-audit', object: 'model', owned_by: 'audit' }],
          }),
        );
        return;
      }
      if (request.method !== 'POST' || url.pathname !== '/v1/chat/completions') {
        response.writeHead(404);
        response.end('{}');
        return;
      }
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      assert.equal(input.model, 'local-audit');
      assert.equal(request.headers.authorization, 'Bearer audit-fake-local-key');
      const isTurn = input.tools?.some((tool) => tool.function?.name === 'read_file');
      report.requests.push({ model: input.model, path: url.pathname, stage: stage?.file, isTurn });
      if (isTurn) {
        report.readFileSchema ||= input.tools.find(
          (tool) => tool.function?.name === 'read_file',
        ).function;
        for (const message of input.messages || []) {
          if (message.role === 'tool' && message.tool_call_id === `probe-${stage.file}`)
            stage.nativeOutput = message.content;
        }
      }
      let toolCall;
      if (isTurn && !emitted) {
        emitted = true;
        toolCall = {
          id: `probe-${stage.file}`,
          type: 'function',
          function: { name: 'read_file', arguments: JSON.stringify(stage.args) },
        };
      }
      const content = isTurn ? 'LOCAL_DOCUMENT_PROBE_DONE' : 'Local document fixture';
      if (input.stream) {
        response.writeHead(200, { 'Content-Type': 'text/event-stream' });
        const chunk = (delta, finish_reason = null) =>
          response.write(
            `data: ${JSON.stringify({ id: 'local-documents', object: 'chat.completion.chunk', created: 1, model: 'local-audit', choices: [{ index: 0, delta, finish_reason }] })}\n\n`,
          );
        chunk({ role: 'assistant', content: '' });
        chunk(toolCall ? { tool_calls: [{ index: 0, ...toolCall }] } : { content });
        chunk({}, toolCall ? 'tool_calls' : 'stop');
        response.end('data: [DONE]\n\n');
      } else {
        response.setHeader('Content-Type', 'application/json');
        response.end(
          JSON.stringify({
            id: 'local-documents',
            object: 'chat.completion',
            created: 1,
            model: 'local-audit',
            choices: [
              {
                index: 0,
                message: {
                  role: 'assistant',
                  ...(toolCall ? { content: null, tool_calls: [toolCall] } : { content }),
                },
                finish_reason: toolCall ? 'tool_calls' : 'stop',
              },
            ],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          }),
        );
      }
    } catch (error) {
      failure = error;
      response.writeHead(500);
      response.end('{}');
    }
  });
  server.on('connect', (request, socket) => {
    report.blockedProxyRequests.push({ method: 'CONNECT', host: request.url });
    socket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const env = {};
  for (const key of [
    'SystemRoot',
    'WINDIR',
    'ComSpec',
    'PATHEXT',
    'PROCESSOR_ARCHITECTURE',
    'NUMBER_OF_PROCESSORS',
  ])
    if (process.env[key]) env[key] = process.env[key];
  const systemRoot = process.env.SystemRoot || 'C:\\Windows';
  Object.assign(env, {
    PATH: [
      path.join(systemRoot, 'System32'),
      path.join(systemRoot, 'System32/WindowsPowerShell/v1.0'),
      path.dirname(process.execPath),
    ].join(path.delimiter),
    USERPROFILE: dirs.profile,
    HOME: dirs.profile,
    GROK_HOME: dirs.home,
    APPDATA: dirs.roaming,
    LOCALAPPDATA: dirs.local,
    TEMP: dirs.tmp,
    TMP: dirs.tmp,
    LOCAL_AUDIT_KEY: 'audit-fake-local-key',
    GROK_DISABLE_AUTOUPDATER: '1',
    GROK_TELEMETRY_ENABLED: '0',
    GROK_FEEDBACK_ENABLED: '0',
    GROK_TELEMETRY_TRACE_UPLOAD: '0',
    GROK_TELEMETRY_MIXPANEL_ENABLED: '0',
    GROK_MANAGED_MCPS_ENABLED: '0',
    GROK_SUBAGENTS: '0',
    GROK_MEMORY: '0',
    GROK_WORKFLOWS: '0',
    GROK_WEB_FETCH: '0',
    HTTP_PROXY: base,
    HTTPS_PROXY: base,
    ALL_PROXY: base,
    NO_PROXY: '127.0.0.1,localhost',
  });
  await fs.writeFile(
    path.join(dirs.home, 'config.toml'),
    `disable_web_search = true
[models]
default = "local-audit"
allowed_models = ["local-audit"]
remote_fetch = false
session_summary = "local-audit"
prompt_suggestion = "local-audit"
max_retries = 0
[model.local-audit]
model = "local-audit"
name = "Local synthetic document probe"
base_url = "${base}/v1"
env_key = "LOCAL_AUDIT_KEY"
api_backend = "chat_completions"
context_window = 32000
[permission]
ask = ["*"]
[cli]
auto_update = false
[features]
telemetry = "off"
backend_tools = false
[managed_mcps]
enabled = false
[relay]
enabled = false
[telemetry]
otel_enabled = false
trace_upload = false
mixpanel_enabled = false
[memory]
enabled = false
[memory_v2]
enabled = false
[toolset.bash]
login_shell_capture = false
auto_background_on_timeout = false
[endpoints]
cli_chat_proxy_base_url = "${base}"
models_base_url = "${base}/v1"
models_list_url = "${base}/v1/models"
xai_api_base_url = "${base}/v1"
managed_config_url = "${base}/managed-config"
feedback_base_url = "${base}"
trace_upload_url = "${base}/traces"
`,
  );
  try {
    report.version = (
      await exec(executable, ['--version'], {
        env,
        cwd: dirs.cwd,
        windowsHide: true,
        timeout: 10000,
      })
    ).stdout.trim();
    client = new GrokClient({
      getExecutable: () => executable,
      spawnFn: (exe, args, options) => {
        const child = spawn(exe, args, { ...options, env, cwd: dirs.cwd });
        children.push(child);
        return child;
      },
      emit: (event) => {
        if (event.type === 'permission') {
          const call = event.params.toolCall;
          const input = call?.rawInput;
          const option = event.params.options.find((item) => item.kind === 'allow_once');
          const permitted =
            call?.kind === 'read' &&
            call?._meta?.['x.ai/tool']?.name === 'read_file' &&
            input?.variant === 'ReadFile' &&
            Object.entries(stage.args).every(([key, value]) => input[key] === value) &&
            Object.keys(input).length === Object.keys(stage.args).length + 1 &&
            option;
          report.permissions.push({
            stage: stage.file,
            permitted: Boolean(permitted),
            params: event.params,
          });
          client.respondPermission({
            requestId: event.requestId,
            ...(permitted ? { optionId: option.optionId } : { cancelled: true }),
          });
          if (!permitted)
            failure = Error('Unexpected permission denied by exact synthetic fixture gate');
        }
        if (
          event.type === 'update' &&
          ['tool_call', 'tool_call_update'].includes(event.update.sessionUpdate)
        )
          stage.toolUpdates.push(event.update);
        if (event.type === 'turn-error') failure = Error(event.message);
      },
    });
    for (stage of stages) {
      emitted = false;
      stage.toolUpdates = [];
      const session = await client.newSession({
        cwd: dirs.cwd,
        modelId: 'local-audit',
        permissionMode: 'ask',
      });
      const start = Date.now();
      await client.send({
        sessionId: session.sessionId,
        text: `LOCAL_DOCUMENT_PROBE: read only synthetic fixture ${stage.file}.`,
      });
      await until(() => !client.activeTurn, stage.file);
      if (failure) throw failure;
      assert.ok(emitted, 'Synthetic read_file was not requested');
      const output =
        typeof stage.nativeOutput === 'string'
          ? stage.nativeOutput
          : JSON.stringify(stage.nativeOutput || '');
      stage.containsMarker = output.includes(stage.marker);
      stage.containsChinese = /[\u3400-\u9fff]/u.test(output);
      stage.elapsedMs = Date.now() - start;
      report.stages.push(stage);
      console.log(
        JSON.stringify({
          file: stage.file,
          fileSize: stage.fileSize,
          containsMarker: stage.containsMarker,
          containsChinese: stage.containsChinese,
          elapsedMs: stage.elapsedMs,
        }),
      );
    }
    report.probeCompleted = true;
  } catch (error) {
    report.error = `${error.name}: ${error.message}`;
    if (stage && !report.stages.includes(stage)) report.stages.push(stage);
    process.exitCode = 1;
  } finally {
    client?.dispose();
    await until(
      () => children.every((child) => child.exitCode !== null || child.signalCode !== null),
      'owned CLI exits',
    );
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    report.authenticationFileCreated = await fs.stat(path.join(dirs.home, 'auth.json')).then(
      () => true,
      () => false,
    );
    // Only this script's mkdtemp directory is eligible for recursive removal.
    assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep));
    await fs.rm(root, { recursive: true, force: true });
    report.cleaned = true;
    await fs.mkdir(path.join(__dirname, '../test-results'), { recursive: true });
    await fs.writeFile(
      path.join(__dirname, '../test-results/cli-large-documents.json'),
      JSON.stringify(report, null, 2) + '\n',
    );
  }
  console.log(
    JSON.stringify({
      version: report.version,
      completed: report.probeCompleted,
      error: report.error,
      cleaned: report.cleaned,
      blockedProxyRequests: report.blockedProxyRequests,
    }),
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
