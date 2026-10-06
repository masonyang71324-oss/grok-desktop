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
        window.changeMode='immediate';
        window.props={options:[{id:'ultra',label:'Ultra'},{id:'max',label:'Max'},{id:'xhigh',label:'Extra high'},{id:'high',label:'High'},{id:'medium-id',value:'medium',label:'Medium',default:true},{id:'low',label:'Low'}],value:'xhigh',disabled:false,modelName:'Grok test',presets:[{id:'quick',value:'low',description:'使用较低推理档位，适合简单任务。'},{id:'standard',value:'medium',description:'使用模型推荐的推理档位。'},{id:'deep',value:'ultra',description:'使用更高推理档位，适合复杂任务，可能等待更久。'}]};
        window.renderEffort=(patch={})=>{window.props={...window.props,...patch};root.render(<EffortControl {...window.props} onChange={value=>{
          window.changes.push(value);
          if(window.changeMode==='deferred') return new Promise((resolve,reject)=>{
            window.resolveChange=(actual=value)=>{window.renderEffort({value:actual,pending:false});resolve();};
            window.rejectChange=()=>reject(new Error('Save failed'));
          });
          window.renderEffort({value});
        }}/>);};
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
    '<style>body{margin:0;font-family:Arial}#root{position:absolute;bottom:32px;right:16px}#outside{position:absolute;top:20px;left:20px}button,select,input{font:inherit}</style><div id="root"></div><button id="outside">Outside</button><textarea aria-label="Draft" style="position:absolute;top:130px;left:20px;width:180px;height:70px"></textarea><div id="blank" style="position:absolute;top:80px;left:20px;width:100px;height:40px">Outside area</div>',
  );
  await page.addStyleTag({ content: css });
  await page.addScriptTag({ content: bundle });
  await trigger(page).waitFor();
  return page;
}
const trigger = (page) => page.getByRole('button', { name: '推理深度', exact: true });
const popup = (page) => page.getByRole('dialog', { name: '推理深度', exact: true });
const slider = (page) => page.getByRole('slider', { name: '推理深度', exact: true });
async function open(page) {
  if (!(await popup(page).isVisible())) await trigger(page).click();
  return slider(page);
}
async function changes(page) {
  return page.evaluate(() => window.changes);
}
async function waitForValue(page, value) {
  await page.waitForFunction(
    (expected) => document.querySelector('input[type="range"]').value === expected,
    String(value),
  );
}

test('reversed advertised options form an ascending slider with exact values, reset, and English labels', async (t) => {
  const page = await fixture(t);
  const control = await open(page);
  assert.equal(await control.inputValue(), '3');
  assert.equal(await control.getAttribute('max'), '5');
  assert.equal(await control.getAttribute('aria-valuetext'), '更深入');
  await control.press('Home');
  await control.press('ArrowRight');
  assert.deepEqual(await changes(page), ['low', 'medium']);
  await page.getByRole('button', { name: '重置推理深度', exact: true }).click();
  assert.deepEqual(await changes(page), ['low', 'medium', '']);
  assert.equal(await control.inputValue(), '1');
  await page.evaluate(() => {
    window.setLanguage('en');
    window.renderEffort({ value: 'high' });
  });
  const englishControl = page.getByRole('slider', { name: 'Reasoning effort', exact: true });
  await englishControl.waitFor();
  assert.equal(await englishControl.getAttribute('aria-valuetext'), 'High');
  await page.getByRole('button', { name: 'Reset reasoning effort', exact: true }).waitFor();
});

test('dragging previews multiple levels and submits only once when released', async (t) => {
  const page = await fixture(t);
  const control = await open(page);
  const bounds = await control.boundingBox();
  await page.mouse.move(bounds.x + bounds.width * 0.6, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 2, bounds.y + bounds.height / 2, { steps: 4 });
  await page.mouse.move(bounds.x + bounds.width - 2, bounds.y + bounds.height / 2, { steps: 12 });
  assert.equal(await control.getAttribute('aria-valuetext'), '极致');
  assert.deepEqual(await changes(page), []);
  await page.mouse.up();
  assert.deepEqual(await changes(page), ['ultra']);
  assert.equal(await popup(page).isVisible(), true);
});

test('held keyboard navigation commits only on release and Escape cancels a new preview', async (t) => {
  const page = await fixture(t);
  const control = await open(page);
  await control.focus();
  await page.keyboard.down('ArrowLeft');
  await page.keyboard.down('ArrowLeft');
  assert.equal(await control.getAttribute('aria-valuetext'), '标准');
  assert.deepEqual(await changes(page), []);
  await page.keyboard.up('ArrowLeft');
  assert.deepEqual(await changes(page), ['medium']);
  await page.keyboard.down('ArrowRight');
  await page.keyboard.press('Escape');
  await page.keyboard.up('ArrowRight');
  await popup(page).waitFor({ state: 'hidden' });
  assert.deepEqual(await changes(page), ['medium']);
  await open(page);
  assert.equal(await control.inputValue(), '1');
});

test('a cancelled pointer gesture discards its local preview', async (t) => {
  const page = await fixture(t);
  const control = await open(page);
  const bounds = await control.boundingBox();
  await page.mouse.move(bounds.x + bounds.width * 0.6, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width - 2, bounds.y + bounds.height / 2);
  await control.dispatchEvent('pointercancel', { pointerId: 1, pointerType: 'mouse' });
  await page.mouse.up();
  assert.deepEqual(await changes(page), []);
  assert.equal(await control.inputValue(), '3');
});

test('accessible input without a pointer or key gesture commits immediately', async (t) => {
  const page = await fixture(t);
  const control = await open(page);
  await control.evaluate((node) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(node, '2');
    node.dispatchEvent(new Event('input', { bubbles: true }));
  });
  assert.deepEqual(await changes(page), ['high']);
});

test('pending saves keep the popup visible and settle to the authoritative returned effort', async (t) => {
  const page = await fixture(t);
  await page.evaluate(() => {
    window.changeMode = 'deferred';
  });
  const control = await open(page);
  await control.press('End');
  await page.waitForFunction(() => typeof window.resolveChange === 'function');
  assert.equal(await popup(page).isVisible(), true);
  assert.equal(await control.isDisabled(), true);
  assert.deepEqual(await changes(page), ['ultra']);
  await page.evaluate(() => window.resolveChange('high'));
  await waitForValue(page, 2);
  assert.equal(await control.isDisabled(), false);
  assert.equal(await control.getAttribute('aria-valuetext'), '深入');
  assert.equal(
    await control.evaluate((node) => node === document.activeElement),
    true,
    'keyboard focus returns to the range after saving so adjustment can continue',
  );
  await page.evaluate(() => window.renderEffort({ pending: true }));
  await page.waitForFunction(() => document.querySelector('input[type="range"]').disabled);
  assert.equal(await popup(page).isVisible(), true);
  await page.evaluate(() => window.renderEffort({ pending: false, value: 'low' }));
  await waitForValue(page, 0);
});

test('a rejected save restores the previous real effort and allows retry', async (t) => {
  const page = await fixture(t);
  await page.evaluate(() => {
    window.changeMode = 'deferred';
  });
  const control = await open(page);
  await control.press('End');
  await page.waitForFunction(() => typeof window.rejectChange === 'function');
  await page.evaluate(() => window.rejectChange());
  await waitForValue(page, 3);
  assert.equal(await control.isDisabled(), false);
  await page.evaluate(() => {
    window.changeMode = 'immediate';
  });
  await control.press('Home');
  assert.deepEqual(await changes(page), ['ultra', 'low']);
});

test('finishing a save after dismissal never steals focus from the user draft', async (t) => {
  const page = await fixture(t);
  await page.evaluate(() => {
    window.changeMode = 'deferred';
  });
  const control = await open(page);
  await control.press('End');
  await page.waitForFunction(() => typeof window.resolveChange === 'function');
  const draft = page.getByRole('textbox', { name: 'Draft', exact: true });
  await draft.click();
  await draft.fill('继续写任务');
  await popup(page).waitFor({ state: 'hidden' });
  await page.evaluate(() => window.resolveChange('ultra'));
  await page.waitForFunction(() => !document.querySelector('.effort-trigger').disabled);
  assert.equal(await draft.evaluate((node) => node === document.activeElement), true);
  assert.equal(await draft.inputValue(), '继续写任务');
  assert.equal(await popup(page).isVisible(), false);
});

test('Escape can dismiss the popup while an asynchronous save is pending', async (t) => {
  const page = await fixture(t);
  await page.evaluate(() => {
    window.changeMode = 'deferred';
  });
  await (await open(page)).press('End');
  await page.waitForFunction(() => typeof window.resolveChange === 'function');
  await page.waitForFunction(() => document.querySelector('input[type="range"]').disabled);
  await page.keyboard.press('Escape');
  await popup(page).waitFor({ state: 'hidden' });
  await page.evaluate(() => window.resolveChange('ultra'));
  await page.waitForFunction(() => !document.querySelector('.effort-trigger').disabled);
  assert.equal(await popup(page).isVisible(), false);
  assert.deepEqual(await changes(page), ['ultra']);
});

test('quick presets remain behind the lightning control and submit exact supported values', async (t) => {
  const page = await fixture(t);
  for (const [name, expected] of [
    ['快速处理', 'low'],
    ['标准处理', 'medium'],
    ['深入处理', 'ultra'],
  ]) {
    await open(page);
    const preset = page.getByRole('button', { name, exact: true });
    if (!(await preset.isVisible()))
      await page.getByRole('button', { name: '推理快捷设置', exact: true }).click();
    await preset.press('Enter');
    assert.equal((await changes(page)).at(-1), expected);
  }
});

test('custom advertised options and unknown current values keep the exact-value native fallback', async (t) => {
  const page = await fixture(t);
  await page.evaluate(() =>
    window.renderEffort({
      options: [
        { id: 'low', label: 'Low' },
        { id: 'custom-id', value: 'custom', label: 'Server custom' },
      ],
      value: 'legacy',
    }),
  );
  await trigger(page).click();
  const select = page.getByRole('combobox', { name: '推理深度', exact: true });
  assert.equal(await select.inputValue(), 'legacy');
  assert.deepEqual(
    await select.locator('option').evaluateAll((items) => items.map((item) => item.value)),
    ['', 'legacy', 'low', 'custom'],
  );
  assert.equal(await slider(page).count(), 0);
  await select.selectOption('custom');
  assert.deepEqual(await changes(page), ['custom']);
  assert.match(await trigger(page).textContent(), /Server custom/);
  if (!(await popup(page).isVisible())) await trigger(page).click();
  await select.selectOption('');
  assert.deepEqual(await changes(page), ['custom', '']);
});

test('an empty value without an advertised default never invents a slider position', async (t) => {
  const page = await fixture(t);
  await page.evaluate(() =>
    window.renderEffort({ options: [{ id: 'low' }, { id: 'high' }], value: '' }),
  );
  await trigger(page).click();
  assert.equal(
    await page.getByRole('combobox', { name: '推理深度', exact: true }).inputValue(),
    '',
  );
  assert.equal(await slider(page).count(), 0);
  assert.deepEqual(await changes(page), []);
});

test('two and one advertised levels work without invented intermediate levels', async (t) => {
  const page = await fixture(t);
  await page.evaluate(() =>
    window.renderEffort({ options: [{ id: 'high' }, { id: 'low' }], value: 'low' }),
  );
  const control = await open(page);
  assert.equal(await control.getAttribute('max'), '1');
  await control.press('End');
  assert.deepEqual(await changes(page), ['high']);
  await page.evaluate(() =>
    window.renderEffort({ options: [{ id: 'high', default: true }], value: 'high' }),
  );
  await page.waitForFunction(() => document.querySelector('input[type="range"]').max === '0');
  assert.equal(await control.getAttribute('max'), '0');
  assert.equal(await control.isDisabled(), true);
  assert.deepEqual(await changes(page), ['high']);
});

test('highest energy stays distinct from penultimate and reduced motion stops the layers', async (t) => {
  const page = await fixture(t);
  const control = await open(page);
  await control.press('End');
  const energy = page.locator('.effort-energy');
  const top = Number(
    await energy.evaluate((node) => getComputedStyle(node).getPropertyValue('--effort-plasma')),
  );
  await control.press('ArrowLeft');
  const penultimate = Number(
    await energy.evaluate((node) => getComputedStyle(node).getPropertyValue('--effort-plasma')),
  );
  assert.equal(top, 1);
  assert.ok(penultimate > 0.3 && penultimate < 0.4, `penultimate intensity was ${penultimate}`);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const motion = await page
    .locator('.effort-energy-flow, .effort-energy-plasma, .effort-energy-particles')
    .evaluateAll((nodes) => nodes.map((node) => getComputedStyle(node).animationName));
  assert.ok(motion.length >= 2);
  assert.ok(motion.every((name) => name === 'none'));
});

test('keyboard opening and Escape restore focus; outside click and Tab dismiss without trapping focus', async (t) => {
  const page = await fixture(t);
  await trigger(page).focus();
  await trigger(page).press('Enter');
  const control = slider(page);
  assert.equal(await control.evaluate((node) => node === document.activeElement), true);
  await control.press('Escape');
  await popup(page).waitFor({ state: 'hidden' });
  assert.equal(await trigger(page).evaluate((node) => node === document.activeElement), true);
  await trigger(page).press('ArrowDown');
  await popup(page).waitFor();
  await page.locator('#blank').click();
  await popup(page).waitFor({ state: 'hidden' });
  assert.equal(await trigger(page).evaluate((node) => node === document.activeElement), false);
  await open(page);
  await control.press('Tab');
  await popup(page).waitFor({ state: 'hidden' });
  assert.equal(
    await page.locator('#outside').evaluate((node) => node === document.activeElement),
    true,
  );
});

test('clicking the external draft dismisses the popup and lets typing continue at the clicked field', async (t) => {
  const page = await fixture(t);
  await open(page);
  const draft = page.getByRole('textbox', { name: 'Draft', exact: true });
  await draft.click();
  await popup(page).waitFor({ state: 'hidden' });
  assert.equal(await draft.evaluate((node) => node === document.activeElement), true);
  await page.keyboard.insertText('继续输入');
  assert.equal(await draft.inputValue(), '继续输入');
});

test('disabling an open control closes it and prevents changes until enabled again', async (t) => {
  const page = await fixture(t);
  await open(page);
  await page.evaluate(() => window.renderEffort({ disabled: true }));
  await popup(page).waitFor({ state: 'hidden' });
  assert.equal(await trigger(page).isDisabled(), true);
  assert.deepEqual(await changes(page), []);
  await page.evaluate(() => window.renderEffort({ disabled: false }));
  await open(page);
  await slider(page).waitFor();
});

test('the popup stays above its trigger and inside a narrow window at the right edge', async (t) => {
  const page = await fixture(t, 360);
  await open(page);
  const bounds = await popup(page).boundingBox();
  const button = await trigger(page).boundingBox();
  assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 360);
  assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= button.y);
});
