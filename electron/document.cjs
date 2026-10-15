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
  'text-limit':
    '本地文档转换内容超过 {limit} MB 的处理预算；这不是 Grok Build 的文件大小限制。请另存为 PDF 后添加。',
  'input-limit':
    '此格式需要本地转换，文件超过 {limit} MB 的转换处理预算。请另存为 PDF 后添加；这不是 Grok Build 的文件大小限制。',
  timeout: '本地文档转换超时，请另存为 PDF 后添加；这不是 Grok Build 的文件大小限制。',
  'resource-limit': '本地文档转换达到结构或内存处理上限，请另存为 PDF 后添加；原文件未更改。',
};
/** @typedef {{timeoutMs?: number, maxTextBytes?: number, maxInputBytes?: number, signal?: AbortSignal}} DocumentOptions */
/** @param {Buffer|string} source @param {string} extension @param {DocumentOptions} [options] */
function extractDocument(
  source,
  extension,
  { timeoutMs = 30000, maxTextBytes = 1024 * 1024, maxInputBytes = 128 * 1024 * 1024, signal } = {},
) {
  const aborted = () =>
    Object.assign(new Error(t('已取消发送。')), { name: 'AbortError', code: 'ABORT_ERR' });
  if (signal?.aborted) return Promise.reject(aborted());
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, 'document-worker.cjs'), {
      workerData: {
        ...(typeof source === 'string' ? { filename: source } : { bytes: source }),
        extension,
        kind: documentKind(extension),
        maxTextBytes,
        maxInputBytes,
      },
      resourceLimits: { maxOldGenerationSizeMb: 256 },
    });
    let settled = false;
    const finish = (error, text) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      const complete = () =>
        error
          ? reject(
              error === 'aborted'
                ? aborted()
                : Object.assign(
                    new Error(
                      t(failures[error] || failures['parse-failed'], {
                        limit:
                          (error === 'input-limit' ? maxInputBytes : maxTextBytes) / (1024 * 1024),
                      }),
                    ),
                    {
                      code:
                        error === 'text-limit'
                          ? 'DOCUMENT_TEXT_LIMIT'
                          : error === 'input-limit'
                            ? 'DOCUMENT_INPUT_LIMIT'
                            : error === 'timeout'
                              ? 'DOCUMENT_TIMEOUT'
                              : error === 'resource-limit'
                                ? 'DOCUMENT_RESOURCE_LIMIT'
                                : 'DOCUMENT_PARSE_FAILED',
                    },
                  ),
            )
          : resolve(text);
      void worker.terminate().then(complete, complete);
    };
    const timer = setTimeout(() => finish('timeout'), timeoutMs);
    const onAbort = () => finish('aborted');
    signal?.addEventListener('abort', onAbort, { once: true });
    worker.once('message', ({ error, text }) => finish(error, text));
    worker.once(
      'error',
      /** @param {Error & {code?: string}} error */ (error) =>
        finish(error.code === 'ERR_WORKER_OUT_OF_MEMORY' ? 'resource-limit' : 'parse-failed'),
    );
    worker.once('exit', () => finish('parse-failed'));
  });
}
/** @param {Buffer|string} source @param {string} extension @param {string} name @param {DocumentOptions} [options] */
async function documentText(source, extension, name, options) {
  return `${name}\n${documentNotice(extension)}\n\n${await extractDocument(source, extension, options)}`;
}
function nativePrompt(filename, extension) {
  const details =
    extension === '.pdf'
      ? 'View the PDF pages visually, including scanned text, tables and images. For long PDFs use the pages parameter in batches (at most 20 pages per call); continue until all pages relevant to the request are read. State the page range actually read and any omissions.'
      : extension === '.pptx'
        ? 'Read the slide text and speaker notes. If the native output is truncated, use an approved local extraction tool to read the remaining slide text in batches; do not repeat the same truncated native read or claim full coverage. Do not claim to have viewed embedded images or charts unless you actually inspect them.'
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
