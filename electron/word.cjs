'use strict';
const path = require('node:path');
const { Worker } = require('node:worker_threads');
const { translate: t } = require('./i18n.cjs');

const wordNotice = () => t('已提取 Word 文字；图片、签章和原始排版未包含在内。');
const failures = {
  'parse-failed': '无法读取 Word 文档。请确认文件未加密且能正常打开，或另存为 TXT 后重试。',
  empty: 'Word 文档中没有可提取的文字。扫描页或图片请另存为图片后添加。',
  'text-limit': 'Word 提取文字超过 1 MB，请拆分文档后重试。',
  timeout: 'Word 文档读取超时，请拆分文档或另存为 TXT 后重试。',
};

function extractWord(bytes, { timeoutMs = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, 'word-worker.cjs'), {
      workerData: { bytes },
      resourceLimits: { maxOldGenerationSizeMb: 128 },
    });
    let settled = false;
    const finish = (error, sections) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const complete = () =>
        error
          ? reject(new Error(t(failures[error] || failures['parse-failed'])))
          : resolve(sections);
      void worker.terminate().then(complete, complete);
    };
    const timer = setTimeout(() => finish('timeout'), timeoutMs);
    worker.once('message', ({ error, sections }) => finish(error, sections));
    worker.once('error', () => finish('parse-failed'));
    worker.once('exit', () => finish('parse-failed'));
  });
}

async function wordText(bytes, name) {
  const sections = await extractWord(bytes);
  return `${name}\n${wordNotice()}\n\n${sections.map(([label, text]) => `${t(label)}\n${text}`).join('\n\n')}`;
}

module.exports = { extractWord, wordText, wordNotice };
