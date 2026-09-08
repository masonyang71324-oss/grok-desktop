const parseRTF = require('rtf-parser');
const { convert } = require('html-to-text');
const { simpleParser } = require('mailparser');
const MsgReader = require('@kenjiuno/msgreader').default;
const { decompressRTF } = require('@kenjiuno/decompressrtf');
const iconv = require('iconv-lite');
const { decodeText } = require('./document-text.cjs');

const TEXT_LIMIT = 1024 * 1024;
const failure = (code, message) => Object.assign(new Error(message), { code });

function htmlText(html) {
  return convert(html, {
    wordwrap: false,
    limits: { maxInputLength: undefined },
    selectors: [{ selector: 'img', format: 'skip' }],
  });
}

function decodeHtml(bytes) {
  // HTML files exported by Chinese office tools often declare GB2312/GBK.
  const head = bytes.subarray(0, 4096).toString('latin1');
  const charset = /<meta\b[^>]*charset\s*=\s*["']?\s*([\w-]+)/i.exec(head)?.[1];
  if (charset && iconv.encodingExists(charset)) return iconv.decode(bytes, charset);
  return decodeText(bytes);
}

function normalizeRTF(bytes) {
  const source = bytes.toString('latin1').trim();
  if (!/^\{\\rtf\d\b/.test(source)) throw failure('unsupported', 'Not an RTF document');
  const output = [];
  const stack = [];
  let uc = 1;
  let hidden = false;
  let deleted = false;
  let uprBranches = null;
  let unicodeAlternative = false;
  let fallback = 0;
  let depth = 0;
  let index = 0;
  while (index < source.length) {
    const char = source[index++];
    if (char === '{') {
      const ansiAlternative = uprBranches === 0;
      const unicodeChild = uprBranches === 1;
      if (uprBranches !== null) uprBranches++;
      stack.push({ uc, hidden, deleted, uprBranches, unicodeAlternative });
      uprBranches = null;
      unicodeAlternative = unicodeChild;
      depth++;
      fallback = 0;
      output.push(ansiAlternative ? '{\\*' : char);
    } else if (char === '}') {
      if (--depth < 0) throw failure('parse-failed', 'Unbalanced RTF groups');
      if (uprBranches !== null && uprBranches !== 2)
        throw failure('parse-failed', 'Invalid RTF Unicode alternate');
      ({ uc, hidden, deleted, uprBranches, unicodeAlternative } = stack.pop());
      fallback = 0;
      output.push(char);
    } else if (char === '\\') {
      const token = /^(?:([a-zA-Z]+)(-?\d+)? ?|'([0-9a-fA-F]{2})|([^a-zA-Z]))/.exec(
        source.slice(index),
      );
      if (!token) throw failure('parse-failed', 'Invalid RTF escape');
      index += token[0].length;
      const [, word, parameter, , symbol] = token;
      if (word === 'bin') {
        const length = Number(parameter);
        if (!Number.isSafeInteger(length) || length < 0 || index + length > source.length)
          throw failure('parse-failed', 'Invalid RTF binary length');
        index += length;
        if (fallback) fallback--;
      } else if (word === 'uc') {
        uc = Number(parameter);
        if (!Number.isSafeInteger(uc) || uc < 0)
          throw failure('parse-failed', 'Invalid RTF Unicode fallback length');
      } else if (word === 'u') {
        const value = Number(parameter);
        if (!Number.isInteger(value) || value < -32768 || value > 65535)
          throw failure('parse-failed', 'Invalid RTF Unicode character');
        if (!hidden && !deleted) output.push(`\\u${value > 32767 ? value - 65536 : value} `);
        fallback = uc;
      } else if (word === 'v') {
        hidden = parameter !== '0';
      } else if (word === 'deleted') {
        deleted = parameter !== '0';
      } else if (word === 'plain') {
        hidden = deleted = false;
        output.push('\\plain ');
      } else if (word === 'upr') {
        uprBranches = 0;
      } else if (
        unicodeAlternative &&
        (word === 'ud' || (symbol === '*' && /^\s*\\ud\b/.test(source.slice(index))))
      ) {
        // Prefer the Unicode branch of an RTF ANSI/Unicode alternate.
      } else if (word === 'ansi') {
        // The parser maps ANSI to ASCII; RTF's default ANSI page is Windows-1252.
        output.push('\\ansi\\ansicpg1252 ');
      } else if (fallback && symbol !== '*' && symbol !== '\n' && symbol !== '\r') {
        fallback--;
      } else if (hidden || deleted) {
        // Character visibility/revision state is inherited and restored by groups.
      } else if (
        ['pict', 'object', 'objdata', 'fldinst', 'datastore', 'themedata'].includes(word)
      ) {
        output.push(`\\*\\${token[0]}`);
      } else if (word === 'cell' || word === 'nestcell') {
        output.push('\\tab ');
      } else if (word === 'row' || word === 'nestrow') {
        output.push('\\par ');
      } else if (symbol === "'") {
        throw failure('parse-failed', 'Invalid RTF hex escape');
      } else {
        output.push(`\\${token[0]}`);
      }
    } else if (char !== '\r' && char !== '\n') {
      if (fallback) fallback--;
      else if (!hidden && !deleted)
        output.push(char.charCodeAt(0) >= 128 ? `\\'${char.charCodeAt(0).toString(16)}` : char);
    }
  }
  if (depth !== 0) throw failure('parse-failed', 'Unbalanced RTF groups');
  return output.join('');
}

async function rtfText(bytes) {
  const normalized = normalizeRTF(bytes);
  const document = await new Promise((resolve, reject) => {
    parseRTF.string(normalized, (error, result) => (error ? reject(error) : resolve(result)));
  });
  function content(node) {
    if (typeof node.value === 'string') return node.value;
    return (node.content || []).map(content).join('') + '\n';
  }
  return document.content.map(content).join('');
}

function address(name, email) {
  return name && email && name !== email ? `${name} <${email}>` : name || email || '';
}

function emailText({ subject, from, to, cc, body, attachments }) {
  const lines = [];
  if (subject) lines.push(`Subject: ${subject}`);
  if (from) lines.push(`From: ${from}`);
  if (to) lines.push(`To: ${to}`);
  if (cc) lines.push(`Cc: ${cc}`);
  if (body) lines.push('', body);
  if (attachments.length)
    lines.push('', 'Attachments (names only):', ...attachments.map((name) => `- ${name}`));
  return lines.join('\n');
}

async function mimeText(bytes) {
  const header = bytes
    .subarray(0, 65536)
    .toString('latin1')
    .split(/\r?\n\r?\n/, 1)[0];
  if (!/^(?:From|To|Subject|MIME-Version|Content-Type):/im.test(header))
    throw failure('unsupported', 'Not a MIME message');
  const mail = await simpleParser(bytes, {
    skipHtmlToText: true,
    skipTextToHtml: true,
    skipImageLinks: true,
  });
  return emailText({
    subject: mail.subject,
    from: mail.from?.text,
    to: Array.isArray(mail.to) ? mail.to.map((value) => value.text).join(', ') : mail.to?.text,
    cc: Array.isArray(mail.cc) ? mail.cc.map((value) => value.text).join(', ') : mail.cc?.text,
    body: mail.text?.trim() ? mail.text : mail.html ? htmlText(mail.html) : '',
    attachments: (mail.attachments || []).map(
      (item) => item.filename || item.contentId || '(unnamed attachment)',
    ),
  });
}

async function msgText(bytes) {
  if (!bytes.subarray(0, 8).equals(Buffer.from('d0cf11e0a1b11ae1', 'hex')))
    throw failure('unsupported', 'Not an Outlook message');
  const mail = new MsgReader(bytes).getFileData();
  if (mail.error) throw failure('parse-failed', mail.error);
  let body = mail.body?.trim()
    ? mail.body
    : mail.bodyHtml
      ? htmlText(mail.bodyHtml)
      : mail.html
        ? htmlText(decodeHtml(Buffer.from(mail.html)))
        : '';
  if (!body.trim() && mail.compressedRtf)
    body = await rtfText(Buffer.from(decompressRTF(mail.compressedRtf)));
  const recipients = (type) =>
    (mail.recipients || [])
      .filter((item) => (item.recipType || 'to') === type)
      .map((item) => address(item.name, item.smtpAddress || item.email))
      .filter(Boolean)
      .join(', ');
  return emailText({
    subject: mail.subject,
    from: address(mail.senderName, mail.senderSmtpAddress || mail.senderEmail),
    to: recipients('to'),
    cc: recipients('cc'),
    body,
    attachments: (mail.attachments || []).map(
      (item) => item.fileName || item.fileNameShort || item.name || '(unnamed attachment)',
    ),
  });
}

module.exports = async function extractRichDocument(input, extension) {
  try {
    const bytes = Buffer.from(input);
    if (!bytes.length) throw failure('empty', 'Empty document');
    const ext = String(extension).toLowerCase().replace(/^\./, '');
    let text;
    if (ext === 'rtf') text = await rtfText(bytes);
    else if (ext === 'html' || ext === 'htm') text = htmlText(decodeHtml(bytes));
    else if (['eml', 'mht', 'mhtml'].includes(ext)) text = await mimeText(bytes);
    else if (ext === 'msg') text = await msgText(bytes);
    else throw failure('unsupported', 'Unsupported rich document extension');
    text = text.replace(/\r\n?/g, '\n').trim();
    if (!text) throw failure('empty', 'Document has no readable text');
    if (Buffer.byteLength(text, 'utf8') > TEXT_LIMIT)
      throw failure('text-limit', 'Document text exceeds 1 MB');
    return text;
  } catch (error) {
    if (['empty', 'text-limit', 'unsupported', 'parse-failed'].includes(error.code)) throw error;
    throw failure('parse-failed', error.message || 'Rich document parsing failed');
  }
};
