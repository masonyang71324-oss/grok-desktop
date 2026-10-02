const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { buildSync } = require('esbuild');
const { launchBrowser } = require('../scripts/browser-launch.cjs');
let browser, script, css;

before(async () => {
  const outputs = buildSync({
    stdin: {
      contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import PromptTemplates from './src/PromptTemplates'; import {setLocale} from './src/i18n'; import './src/styles.css'; const root=createRoot(document.getElementById('root')); window.setLanguage=setLocale; window.showTemplates=(props={})=>root.render(<PromptTemplates items={window.initialItems} draft={window.initialDraft} {...props} onSave={async items=>{window.saves.push(items); if(window.failSave) throw new Error('settings write failed'); window.persisted=items;}} onUse={text=>window.used.push(text)} onClose={()=>window.closeCount++}/>);`,
      loader: 'tsx',
      resolveDir: path.join(__dirname, '..'),
    },
    bundle: true,
    write: false,
    outfile: 'prompt-templates-test.js',
    format: 'iife',
    platform: 'browser',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"development"' },
  }).outputFiles;
  script = outputs.find((output) => output.path.endsWith('.js')).text;
  css = outputs.find((output) => output.path.endsWith('.css')).text;
  browser = await launchBrowser();
});
after(async () => browser?.close());

async function fixture(t, items = [], draft = '') {
  const page = await browser.newPage({ viewport: { width: 390, height: 720 } });
  t.after(() => page.close());
  page.setDefaultTimeout(5000);
  await page.route('http://localhost/', (route) =>
    route.fulfill({ body: '<div id="root"></div>', contentType: 'text/html' }),
  );
  await page.goto('http://localhost/');
  await page.addStyleTag({ content: css });
  await page.evaluate(
    ({ items, draft }) => {
      window.initialItems = items;
      window.initialDraft = draft;
      window.persisted = items;
      window.saves = [];
      window.used = [];
      window.closeCount = 0;
      window.failSave = false;
    },
    { items, draft },
  );
  await page.addScriptTag({ content: script });
  await page.evaluate(() => window.showTemplates());
  await page.getByRole('dialog', { name: '提示词收藏' }).waitFor();
  return page;
}

test('saving the current draft creates a named favorite and preserves all prompt whitespace', async (t) => {
  const draft = '\n  Review this code. \n\nKeep whitespace.  \n';
  const page = await fixture(t, [], draft);
  await page.getByRole('button', { name: '保存当前草稿', exact: true }).click();
  assert.equal(await page.getByLabel('提示词内容', { exact: true }).inputValue(), draft);
  await page.getByLabel('收藏名称', { exact: true }).fill('代码审查');
  await page.getByRole('button', { name: '保存收藏', exact: true }).click();
  await page.getByRole('button', { name: '使用“代码审查”', exact: true }).waitFor();
  const saved = await page.evaluate(() => window.persisted);
  assert.equal(saved.length, 1);
  assert.equal(typeof saved[0].id, 'string');
  assert.ok(saved[0].id.length > 0);
  assert.equal(saved[0].name, '代码审查');
  assert.equal(saved[0].text, draft);
});

test('failed edits retain the collection, name, and exact text for a successful retry', async (t) => {
  const original = { id: 'one', name: '代码审查', text: '  original\n' };
  const page = await fixture(t, [original]);
  await page.getByRole('button', { name: '编辑“代码审查”', exact: true }).click();
  await page.getByLabel('收藏名称', { exact: true }).fill('详细审查');
  const edited = '\t  exact prompt\n\n';
  await page.getByLabel('提示词内容', { exact: true }).fill(edited);
  await page.evaluate(() => {
    window.failSave = true;
  });
  await page.getByRole('button', { name: '保存收藏', exact: true }).click();
  await page.getByRole('alert').getByText('settings write failed', { exact: true }).waitFor();
  assert.deepEqual(await page.evaluate(() => window.persisted), [original]);
  assert.equal(await page.getByLabel('收藏名称', { exact: true }).inputValue(), '详细审查');
  assert.equal(await page.getByLabel('提示词内容', { exact: true }).inputValue(), edited);
  await page.evaluate(() => {
    window.failSave = false;
  });
  await page.getByRole('button', { name: '保存收藏', exact: true }).click();
  await page.getByRole('button', { name: '使用“详细审查”', exact: true }).waitFor();
  assert.deepEqual(await page.evaluate(() => window.persisted), [
    { id: 'one', name: '详细审查', text: edited },
  ]);
});

test('deletion requires confirmation and a failed delete retains the original favorite', async (t) => {
  const original = { id: 'one', name: '代码审查', text: 'review' };
  const page = await fixture(t, [original]);
  await page.getByRole('button', { name: '删除“代码审查”', exact: true }).click();
  assert.equal(await page.evaluate(() => window.saves.length), 0);
  await page.getByRole('button', { name: '取消删除', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: '使用“代码审查”', exact: true }).count(), 1);
  await page.getByRole('button', { name: '删除“代码审查”', exact: true }).click();
  await page.evaluate(() => {
    window.failSave = true;
  });
  await page.getByRole('button', { name: '确认删除', exact: true }).click();
  await page.getByRole('alert').getByText('settings write failed', { exact: true }).waitFor();
  assert.deepEqual(await page.evaluate(() => window.persisted), [original]);
  assert.equal(await page.getByRole('button', { name: '使用“代码审查”', exact: true }).count(), 1);
  await page.evaluate(() => {
    window.failSave = false;
  });
  await page.getByRole('button', { name: '确认删除', exact: true }).click();
  await page.getByText('还没有收藏的提示词。', { exact: true }).waitFor();
  assert.deepEqual(await page.evaluate(() => window.persisted), []);
});

test('using a favorite passes its exact text without saving or sending a prompt', async (t) => {
  const text = '\n  first\nsecond  \n';
  const page = await fixture(t, [{ id: 'one', name: '代码审查', text }]);
  await page.getByRole('button', { name: '使用“代码审查”', exact: true }).click();
  assert.deepEqual(await page.evaluate(() => window.used), [text]);
  assert.equal(await page.evaluate(() => window.saves.length), 0);
  assert.equal(await page.evaluate(() => window.closeCount), 1);
});

test('form limits reject oversized input without truncating its text or starting a save', async (t) => {
  const page = await fixture(t);
  await page.getByRole('button', { name: '新建收藏', exact: true }).click();
  const name = 'n'.repeat(81);
  await page.getByLabel('收藏名称', { exact: true }).fill(name);
  await page.getByLabel('提示词内容', { exact: true }).fill('prompt');
  await page.getByRole('button', { name: '保存收藏', exact: true }).click();
  await page.getByRole('alert').getByText('名称最多 80 个字符。', { exact: true }).waitFor();
  assert.equal(await page.getByLabel('收藏名称', { exact: true }).inputValue(), name);
  await page.getByLabel('收藏名称', { exact: true }).fill('valid');
  const text = 'x'.repeat(20001);
  await page.getByLabel('提示词内容', { exact: true }).fill(text);
  await page.getByRole('button', { name: '保存收藏', exact: true }).click();
  await page.getByRole('alert').getByText('提示词最多 20,000 个字符。', { exact: true }).waitFor();
  assert.equal(await page.getByLabel('提示词内容', { exact: true }).inputValue(), text);
  assert.equal(await page.evaluate(() => window.saves.length), 0);
});

test('twenty favorites explain the capacity limit and keep the whole collection', async (t) => {
  const items = Array.from({ length: 20 }, (_, index) => ({
    id: String(index),
    name: `收藏 ${index}`,
    text: `prompt ${index}`,
  }));
  const page = await fixture(t, items, 'new draft');
  await page.getByText('最多收藏 20 条提示词。', { exact: true }).waitFor();
  assert.equal(
    await page.getByRole('button', { name: '新建收藏', exact: true }).isDisabled(),
    true,
  );
  assert.equal(
    await page.getByRole('button', { name: '保存当前草稿', exact: true }).isDisabled(),
    true,
  );
  assert.deepEqual(await page.evaluate(() => window.persisted), items);
});

test('the English dialog uses translated controls and fits a narrow viewport', async (t) => {
  const page = await fixture(t, [], 'draft');
  await page.evaluate(() => window.setLanguage('en'));
  await page.getByRole('dialog', { name: 'Prompt favorites' }).waitFor();
  await page.getByRole('button', { name: 'Save current draft', exact: true }).click();
  assert.equal(await page.getByLabel('Prompt text', { exact: true }).inputValue(), 'draft');
  assert.equal(await page.getByRole('button', { name: 'Save favorite', exact: true }).count(), 1);
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    true,
  );
});
