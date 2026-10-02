const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { _electron: electron } = require('playwright');

test(
  'native preview runs local modules without host bridge, denies permissions and routes explicit external open',
  { timeout: 30000 },
  async (t) => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'grok-content-native-'));
    let app;
    const server = http.createServer((request, response) => {
      if (request.url === '/module.js') {
        response.writeHead(200, { 'Content-Type': 'text/javascript' });
        response.end(`import { canary } from './value.js';
        document.querySelector('#canary').textContent=canary;
        window.moduleUrl=import.meta.url;
        window.boundary={desktop:typeof window.desktop,preview:typeof window.preview,require:typeof require,process:typeof process};
        navigator.geolocation.getCurrentPosition(()=>window.permission='granted',error=>window.permission=error.code);`);
      } else if (request.url === '/value.js') {
        response.writeHead(200, { 'Content-Type': 'text/javascript' });
        response.end("export const canary='LOCAL_MODULE_CANARY';");
      } else {
        response.writeHead(200, { 'Content-Type': 'text/html' });
        response.end(
          '<!doctype html><h1 id="canary">Loading</h1><a id="next" href="/second" target="_blank">Next</a><script type="module" src="/module.js"></script>',
        );
      }
    });
    t.after(async () => {
      if (app) await app.close();
      await new Promise((resolve) => server.close(resolve));
      await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const env = { ...process.env, GROK_CONTENT_TEST_DATA: directory };
    delete env.ELECTRON_RUN_AS_NODE;
    app = await electron.launch({
      args: [path.join(__dirname, 'fixtures/content-preview-host.cjs')],
      env,
    });
    await app.firstWindow();
    await app.evaluate(
      async (_electron, url) =>
        contentProbe.manager.open({
          url,
          owner: { cwd: 'C:/fixture', draftKey: 'canary-draft' },
        }),
      origin,
    );
    const remoteEval = (script) =>
      app.evaluate(
        async ({ webContents }, { origin, script }) => {
          const remote = webContents
            .getAllWebContents()
            .find((wc) => wc.getURL().startsWith(origin));
          return remote ? remote.executeJavaScript(script, true) : null;
        },
        { origin, script },
      );
    const until = async (check) => {
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        if (await check()) return;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      assert.fail('Local preview condition did not settle');
    };
    await until(() =>
      remoteEval(
        "document.querySelector('#canary')?.textContent==='LOCAL_MODULE_CANARY' && window.permission !== undefined",
      ),
    );
    assert.deepEqual(await remoteEval('window.boundary'), {
      desktop: 'undefined',
      preview: 'undefined',
      require: 'undefined',
      process: 'undefined',
    });
    assert.equal(await remoteEval('window.permission'), 1);
    assert.equal(await remoteEval('window.moduleUrl'), `${origin}/module.js`);
    assert.deepEqual(await app.evaluate(() => contentProbe.external), []);
    await remoteEval("document.querySelector('#next').click()");
    await until(() => remoteEval("location.pathname==='/second'"));
    const chrome = app.windows().find((page) => page.url().endsWith('/preview.html'));
    assert.ok(chrome);
    await chrome.locator('[data-action="external"]').click();
    await until(() => app.evaluate(() => contentProbe.external.length === 1));
    assert.deepEqual(await app.evaluate(() => contentProbe.external), [`${origin}/second`]);
    const refused = await chrome.evaluate(() =>
      window.preview.request({ action: 'navigate', url: 'file:///C:/CANARY_NOT_READ' }),
    );
    assert.equal(refused.ok, false);
    assert.equal(await remoteEval('location.href'), `${origin}/second`);
    assert.deepEqual(await app.evaluate(() => contentProbe.events), []);
  },
);
