'use strict';
const path = require('node:path');
const { Worker } = require('node:worker_threads');
const { translate: t } = require('./i18n.cjs');

const groups = {
  word: ['doc', 'docx', 'docm', 'dot', 'dotx', 'dotm', 'wps', 'wpt'],
  sheets: [
    'xls',
    'xlsx',
    'xlsm',
    'xlsb',
    'xlt',
    'xltx',
    'xltm',
    'et',
    'ett',
    'ods',
    'ots',
    'fods',
    'uos',
    'csv',
    'tsv',
  ],
  rich: ['rtf', 'eml', 'msg', 'mht', 'mhtml', 'html', 'htm'],
  structured: ['odt', 'ott', 'odp', 'otp', 'fodt', 'fodp', 'ofd', 'epub'],
  ppt: ['ppt', 'pps', 'pot', 'dps', 'dpt', 'pptm', 'ppsx', 'ppsm', 'potx', 'potm'],
};
const native = new Set(['.pdf', '.pptx', '.ipynb']);
const extensions = Object.values(groups).flat();
function documentKind(extension) {
  return Object.entries(groups).find(([, list]) =>
    list.includes(extension.replace(/^\./, '').toLowerCase()),
  )?.[0];
}
const documentNotice = (extension) =>
  t(
    documentKind(extension || '') === 'sheets'
      ? '已提取工作表和单元格数据；公式显示文件中的已有结果，不会重新计算。图片、图表和排版未包含在内。'
      : ['.eml', '.msg', '.mht', '.mhtml'].includes(extension)
        ? '已提取正文和邮件信息；内嵌附件仅列出名称，需另行添加才能读取。图片和排版未包含在内。'
        : '已提取文档文字；图片、签章和原始排版未包含在内。',
  );
const failures = {
  'parse-failed': '无法读取文档。请确认文件未加密且能正常打开，或另存为 PDF、DOCX、XLSX 后重试。',
  unsupported: '暂不支持此文件的内部格式。请用原软件另存为 PDF、DOCX 或 XLSX 后重试。',
  empty: '文档中没有可提取的文字或数据。扫描文档请另存为 PDF 或图片后添加。',
  'text-limit': '文档提取内容超过 1 MB，请拆分文档后重试。',
  timeout: '文档读取超时，请拆分文档或另存为 PDF 后重试。',
};
function extractDocument(bytes, extension, { timeoutMs = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, 'document-worker.cjs'), {
      workerData: { bytes, extension, kind: documentKind(extension) },
      resourceLimits: { maxOldGenerationSizeMb: 256 },
    });
    let settled = false;
    const finish = (error, text) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const complete = () =>
        error ? reject(new Error(t(failures[error] || failures['parse-failed']))) : resolve(text);
      void worker.terminate().then(complete, complete);
    };
    const timer = setTimeout(() => finish('timeout'), timeoutMs);
    worker.once('message', ({ error, text }) => finish(error, text));
    worker.once('error', () => finish('parse-failed'));
    worker.once('exit', () => finish('parse-failed'));
  });
}
async function documentText(bytes, extension, name) {
  return `${name}\n${documentNotice(extension)}\n\n${await extractDocument(bytes, extension)}`;
}
function nativePrompt(filename, extension) {
  const details =
    extension === '.pdf'
      ? 'View the PDF pages visually, including scanned text, tables and images. For long PDFs use the pages parameter in batches (at most 20 pages per call); continue until all pages relevant to the request are read. State the page range actually read and any omissions.'
      : extension === '.pptx'
        ? 'Read the slide text and speaker notes. Continue with offset/limit if the tool truncates output. Do not claim to have viewed embedded images or charts unless you actually inspect them.'
        : 'Read notebook cells and existing outputs. Do not execute the notebook merely to read it.';
  return `Attached local document (JSON-encoded absolute path): ${JSON.stringify(filename)}\nUse the built-in read_file tool to read this exact file before answering. ${details} If reading fails, explain the actual error and do not guess the contents.`;
}
function nativeDescription(extension) {
  return extension === '.pdf'
    ? t('发送后由 Grok 原生读取 PDF 页面，支持扫描页和图片。读取范围以会话中的工具结果为准。')
    : extension === '.pptx'
      ? t('发送后由 Grok 原生读取幻灯片文字和备注；不保证读取其中的图片和图表。')
      : t('发送后由 Grok 原生读取笔记本单元格和已有输出，不会为预览运行代码。');
}
module.exports = {
  documentKind,
  documentText,
  documentNotice,
  extractDocument,
  native,
  nativePrompt,
  nativeDescription,
  extensions,
  groups,
};
