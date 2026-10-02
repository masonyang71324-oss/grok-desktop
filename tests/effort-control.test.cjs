const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { buildSync } = require('esbuild');
const { launchBrowser } = require('../scripts/browser-launch.cjs');

let browser, bundle, css;
before(async () => {
  const files = buildSync({
    stdin: {
      contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import EffortControl from './src/EffortControl'; import {setLocale} from './src/i18n';
        const root=createRoot(document.getElementById('root'));
        window.setLanguage=setLocale;
        window.changes=[];
        window.props={options:[{id:'low',label:'Low'},{id:'medium',label:'Medium',default:true},{id:'high',label:'High'},{id:'xhigh',label:'Extra high'},{id:'custom-id',value:'custom',label:'Server custom'}],value:'xhigh',disabled:false,presets:[{id:'quick',value:'low',description:'使用较低推理档位，适合简单任务。'},{id:'standard',value:'medium',description:'使用模型推荐的推理档位。'},{id:'deep',value:'xhigh',description:'使用更高推理档位，适合复杂任务，可能等待更久。'}]};
        window.renderEffort=(patch={})=>{window.props={...window.props,...patch};root.render(<EffortControl {...window.props} onChange={value=>{window.changes.push(value);window.renderEffort({value});}}/>);};
        window.renderEffort();`,
      loader: 'tsx',
      resolveDir: path.join(__dirname, '..'),
    },
    outfile: 'effort-control.js',
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"development"' },
  }).outputFiles;
  bundle = files.find((file) => file.path.endsWith('.js')).text;
  css = files.find((file) => file.path.endsWith('.css')).text;
  browser = await launchBrowser();
});
after(async () => browser?.close());

async function fixture(t, width = 640) {
  const page = await browser.newPage({ viewport: { width, height: 480 } });
  t.after(() => page.close());
  page.setDefaultTimeout(5000);
  await page.setContent(
    '<style>body{margin:0;font-family:Arial}#root{position:absolute;bottom:32px;right:16px}#outside{position:absolute;top:20px;left:20px}button,select{font:inherit}</style><div id="root"></div><button id="outside">Outside</button><textarea aria-label="Draft" style="position:absolute;top:130px;left:20px;width:180px;height:70px"></textarea><div id="blank" style="position:absolute;top:80px;left:20px;width:100px;height:40px">Outside area</div>',
  );
  await page.addStyleTag({ content: css });
  await page.addScriptTag({ content: bundle });
  await page.getByRole('button', { name: '推理深度', exact: true }).waitFor();
  return page;
}

test('shows the actual effort and retains every advertised exact option plus default', async (t) => {
  const page = await fixture(t);
  const trigger = page.getByRole('button', { name: '推理深度', exact: true });
  assert.match(await trigger.textContent(), /更深入/);
  await trigger.click();
  const select = page.getByRole('combobox', { name: '推理深度', exact: true });
  assert.deepEqual(
    await select
      .locator('option')
      .evaluateAll((items) => items.map((item) => [item.value, item.textContent])),
    [
      ['', '默认推理'],
      ['low', '轻量'],
      ['medium', '标准'],
      ['high', '深入'],
      ['xhigh', '更深入'],
      ['custom', 'Server custom'],
    ],
  );
  await select.selectOption('custom');
  await page.getByRole('dialog', { name: '推理深度', exact: true }).waitFor({ state: 'hidden' });
  assert.match(await trigger.textContent(), /Server custom/);
  await trigger.click();
  await select.selectOption('');
  assert.match(await trigger.textContent(), /默认推理/);
  assert.deepEqual(await page.evaluate(() => window.changes), ['custom', '']);
  await page.evaluate(() => {
    window.setLanguage('en');
    window.renderEffort({ value: 'high' });
  });
  assert.match(
    await page.getByRole('button', { name: 'Reasoning effort', exact: true }).textContent(),
    /High/,
  );
});

test('all quick presets submit their precise supported effort values', async (t) => {
  const page = await fixture(t);
  for (const [name, expected] of [
    ['快速处理', 'low'],
    ['标准处理', 'medium'],
    ['深入处理', 'xhigh'],
  ]) {
    await page.getByRole('button', { name: '推理深度', exact: true }).click();
    const preset = page.getByRole('button', { name, exact: true });
    await preset.focus();
    await preset.press('Enter');
    await page.getByRole('dialog', { name: '推理深度', exact: true }).waitFor({ state: 'hidden' });
    assert.equal(await page.evaluate(() => window.changes.at(-1)), expected);
  }
});

test('keyboard opening and Escape restore focus; outside click and Tab dismiss without trapping focus', async (t) => {
  const page = await fixture(t);
  const trigger = page.getByRole('button', { name: '推理深度', exact: true });
  const popup = page.getByRole('dialog', { name: '推理深度', exact: true });
  const select = page.getByRole('combobox', { name: '推理深度', exact: true });
  await trigger.focus();
  await trigger.press('Enter');
  assert.equal(await select.evaluate((node) => node === document.activeElement), true);
  await select.press('Escape');
  await popup.waitFor({ state: 'hidden' });
  assert.equal(await trigger.evaluate((node) => node === document.activeElement), true);
  await trigger.press('ArrowDown');
  await popup.waitFor();
  await page.locator('#blank').click();
  await popup.waitFor({ state: 'hidden' });
  assert.equal(await trigger.evaluate((node) => node === document.activeElement), false);
  await trigger.click();
  await select.press('Tab');
  await popup.waitFor({ state: 'hidden' });
  assert.equal(
    await page.locator('#outside').evaluate((node) => node === document.activeElement),
    true,
  );
});

test('clicking the external draft dismisses the popup and lets typing continue at the clicked field', async (t) => {
  const page = await fixture(t);
  await page.getByRole('button', { name: '推理深度', exact: true }).click();
  const draft = page.getByRole('textbox', { name: 'Draft', exact: true });
  await draft.click();
  await page.getByRole('dialog', { name: '推理深度', exact: true }).waitFor({ state: 'hidden' });
  assert.equal(await draft.evaluate((node) => node === document.activeElement), true);
  await page.keyboard.insertText('继续输入');
  assert.equal(await draft.inputValue(), '继续输入');
});

test('disabling an open control closes it and prevents changes until enabled again', async (t) => {
  const page = await fixture(t);
  const trigger = page.getByRole('button', { name: '推理深度', exact: true });
  await trigger.click();
  await page.evaluate(() => window.renderEffort({ disabled: true }));
  await page.getByRole('dialog', { name: '推理深度', exact: true }).waitFor({ state: 'hidden' });
  assert.equal(await trigger.isDisabled(), true);
  assert.deepEqual(await page.evaluate(() => window.changes), []);
  await page.evaluate(() => window.renderEffort({ disabled: false }));
  await trigger.click();
  await page.getByRole('combobox', { name: '推理深度', exact: true }).waitFor();
});

test('the popup stays above its trigger and inside a narrow window at the right edge', async (t) => {
  const page = await fixture(t, 360);
  const trigger = page.getByRole('button', { name: '推理深度', exact: true });
  await trigger.click();
  const popup = await page.getByRole('dialog', { name: '推理深度', exact: true }).boundingBox();
  const button = await trigger.boundingBox();
  assert.ok(popup.x >= 0 && popup.x + popup.width <= 360);
  assert.ok(popup.y >= 0 && popup.y + popup.height <= button.y);
});
