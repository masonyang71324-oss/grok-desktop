'use strict';
const path = require('node:path');
const { Worker } = require('node:worker_threads');
const { translate: t } = require('./i18n.cjs');

const wordNotice = () => t('已提取 Word 文字；图片、签章和原始排版未包含在内。');
const failures = {
  'parse-failed': '无法读取 Word 文档。请确认文件未加密且能正常打开，或另存为 TXT 后重试。',
  empty: 'Word 文档中没有可提取的文字。扫描页或图片请另存为图片后添加。',
  'text-limit':
    '本地 Word 转换文字超过 {limit} MB 的处理预算；这不是 Grok Build 的文件大小限制。请另存为 PDF 后添加。',
  timeout: '本地 Word 转换超时，请另存为 PDF 后添加；这不是 Grok Build 的文件大小限制。',
  'resource-limit': '本地 Word 转换达到内存处理预算，请另存为 PDF 后添加；原文件未更改。',
};

/** @typedef {{timeoutMs?: number, maxTextBytes?: number, signal?: AbortSignal}} WordOptions */
/** @param {Buffer|string} source @param {WordOptions} [options] */
function extractWord(source, { timeoutMs = 30000, maxTextBytes = 1024 * 1024, signal } = {}) {
  const aborted = () =>
    Object.assign(new Error(t('已取消发送。')), { name: 'AbortError', code: 'ABORT_ERR' });
  if (signal?.aborted) return Promise.reject(aborted());
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, 'word-worker.cjs'), {
      workerData: {
        ...(typeof source === 'string' ? { filename: source } : { bytes: source }),
        maxTextBytes,
      },
      resourceLimits: { maxOldGenerationSizeMb: 128 },
    });
    let settled = false;
    const finish = (error, sections) => {
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
                        limit: maxTextBytes / (1024 * 1024),
                      }),
                    ),
                    {
                      code:
                        error === 'text-limit'
                          ? 'DOCUMENT_TEXT_LIMIT'
                          : error === 'timeout'
                            ? 'DOCUMENT_TIMEOUT'
                            : error === 'resource-limit'
                              ? 'DOCUMENT_RESOURCE_LIMIT'
                              : 'DOCUMENT_PARSE_FAILED',
                    },
                  ),
            )
          : resolve(sections);
      void worker.terminate().then(complete, complete);
    };
    const timer = setTimeout(() => finish('timeout'), timeoutMs);
    const onAbort = () => finish('aborted');
    signal?.addEventListener('abort', onAbort, { once: true });
    worker.once('message', ({ error, sections }) => finish(error, sections));
    worker.once(
      'error',
      /** @param {Error & {code?: string}} error */ (error) =>
        finish(
          error.code === 'ERR_WORKER_OUT_OF_MEMORY'
            ? 'resource-limit'
            : error.code === 'text-limit'
              ? 'text-limit'
              : 'parse-failed',
        ),
    );
    worker.once('exit', () => finish('parse-failed'));
  });
}

/** @param {Buffer|string} source @param {string} name @param {WordOptions} [options] */
async function wordText(source, name, options) {
  const sections = await extractWord(source, options);
  return `${name}\n${wordNotice()}\n\n${sections.map(([label, text]) => `${t(label)}\n${text}`).join('\n\n')}`;
}

module.exports = { extractWord, wordText, wordNotice };
