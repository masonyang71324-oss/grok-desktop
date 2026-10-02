'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { Worker } = require('node:worker_threads');
const { getLocale } = require('./i18n.cjs');
const messages = {
  '请选择有效的 Office 文件。': 'Select a valid Office file.',
  '暂不支持此 Office 预览格式。': 'This Office preview format is unsupported.',
  'Office 排版预览支持不超过 10 MB 的文件。': 'Office layout preview supports files up to 10 MB.',
  'Office 排版预览超时，请用默认程序打开原文件。':
    'Office layout preview timed out. Open the original file with the default app.',
  '无法读取排版预览。请用默认程序打开原文件，或另存为 DOCX、XLSX、PPTX 后重试。':
    'Could not read layout preview. Open the original file with the default app, or save as DOCX, XLSX or PPTX and retry.',
};
const message = (key) => (getLocale() === 'en' ? messages[key] || key : key);
const EXTENSIONS = new Set([
  '.docx',
  '.doc',
  '.docm',
  '.dot',
  '.dotx',
  '.xlsx',
  '.xls',
  '.xlsm',
  '.xlsb',
  '.ods',
  '.csv',
  '.tsv',
  '.pptx',
  '.ppt',
  '.pptm',
  '.pps',
  '.ppsx',
  '.pot',
  '.potx',
]);

async function previewOffice({ path: filename }, { timeoutMs = 30000 } = {}) {
  if (typeof filename !== 'string' || !path.isAbsolute(filename))
    throw new Error(message('请选择有效的 Office 文件。'));
  const extension = path.extname(filename).toLowerCase();
  if (!EXTENSIONS.has(extension)) throw new Error(message('暂不支持此 Office 预览格式。'));
  const stat = await fs.stat(filename);
  if (!stat.isFile()) throw new Error(message('请选择有效的 Office 文件。'));
  if (stat.size > 10 * 1024 * 1024)
    throw new Error(message('Office 排版预览支持不超过 10 MB 的文件。'));
  const bytes = await fs.readFile(filename);
  if (bytes.length > 10 * 1024 * 1024)
    throw new Error(message('Office 排版预览支持不超过 10 MB 的文件。'));
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, 'office-preview-worker.cjs'), {
      workerData: { bytes, extension },
      resourceLimits: { maxOldGenerationSizeMb: 256 },
    });
    let settled = false;
    const finish = (error, model) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const complete = () => (error ? reject(new Error(message(error))) : resolve(model));
      void worker.terminate().then(complete, complete);
    };
    const failed = '无法读取排版预览。请用默认程序打开原文件，或另存为 DOCX、XLSX、PPTX 后重试。';
    const timer = setTimeout(
      () => finish('Office 排版预览超时，请用默认程序打开原文件。'),
      timeoutMs,
    );
    worker.once('message', ({ model, error }) => finish(error ? failed : undefined, model));
    worker.once('error', () => finish(failed));
    worker.once('exit', () => finish(failed));
  });
}
module.exports = { previewOffice };
