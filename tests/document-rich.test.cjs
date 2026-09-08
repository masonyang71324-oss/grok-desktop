const test = require('node:test');
const assert = require('node:assert/strict');
const iconv = require('iconv-lite');
const CFB = require('cfb');
const extract = require('../electron/document-rich.cjs');

test('RTF decodes GBK hex runs and skips unicode fallback characters', async () => {
  const source = String.raw`{\rtf1\ansi\ansicpg936 中文占位\par \'d6\'d0\'ce\'c4\par \uc1\u20013?\u25991? {\uc2\u27979??}\u35797?}`;
  const bytes = iconv.encode(source, 'gbk');
  const text = await extract(bytes, '.rtf');
  assert.match(text, /中文占位\n中文\n中文 测试/);
  assert.doesNotMatch(text, /\?|rtf1|ansicpg/);
});

test('RTF excludes image/object payload and field instructions while retaining results', async () => {
  const bytes = Buffer.from(
    String.raw`{\rtf1\ansi Visible{\pict\pngblip ABCDEF012345}{\object\objdata SECRET}{\field{\*\fldinst HYPERLINK "hidden"}{\fldrslt Link}}\par End}`,
  );
  const text = await extract(bytes, '.rtf');
  assert.match(text, /VisibleLink\nEnd/);
  assert.doesNotMatch(text, /ABCDEF|SECRET|HYPERLINK/);
});

test('RTF rejects broken structure and malformed escaped bytes', async () => {
  for (const source of [String.raw`{\rtf1 broken`, String.raw`{\rtf1 \'zz}`]) {
    await assert.rejects(extract(Buffer.from(source), '.rtf'), { code: 'parse-failed' });
  }
});

test('RTF default ANSI encoding preserves accented letters', async () => {
  assert.equal(await extract(Buffer.from(String.raw`{\rtf1\ansi caf\'e9}`), '.rtf'), 'café');
});

test('RTF reads final text without concatenating deleted revisions or hidden runs', async () => {
  const source = String.raw`{\rtf1\ansi Amount: {\deleted 9000}{\revised 1000}\par {\v hidden}visible\par \deleted old\deleted0 current}`;
  assert.equal(await extract(Buffer.from(source), '.rtf'), 'Amount: 1000\nvisible\ncurrent');
});

test('RTF selects Chinese Unicode alternate instead of the ANSI fallback', async () => {
  const source = String.raw`{\rtf1\ansi Before {\upr{???}{\*\ud\u20013?\u25991?}} after}`;
  assert.equal(await extract(Buffer.from(source), '.rtf'), 'Before 中文 after');
});

test('RTF font charset supports traditional Chinese and separates table cells', async () => {
  const source = String.raw`{\rtf1\ansi{\fonttbl{\f0\fnil\fcharset136 Ming;}}\f0 \'a4\'a4\'a4\'e5\cell A\row B}`;
  assert.match(await extract(Buffer.from(source), '.rtf'), /中文\tA\nB/);
});

test('HTML decodes declared Chinese charset and keeps visible text only', async () => {
  const bytes = iconv.encode(
    '<html><head><meta charset="gb2312"><style>SECRET</style></head><body><h1>中文标题</h1><p>甲 &amp; 乙</p><script>SECRET</script></body></html>',
    'gbk',
  );
  const text = await extract(bytes, '.html');
  assert.match(text, /中文标题[\s\S]*甲 & 乙/);
  assert.doesNotMatch(text, /SECRET|charset|<html>/);
});

function mime(type = 'mixed') {
  return Buffer.from(
    [
      'MIME-Version: 1.0',
      'Subject: =?UTF-8?B?5Lit5paH6YKu5Lu2?=',
      'From: =?UTF-8?B?5byg5LiJ?= <zhang@example.com>',
      'To: li@example.com',
      `Content-Type: multipart/${type}; boundary="fixture"`,
      '',
      '--fixture',
      'Content-Type: text/html; charset=utf-8',
      'Content-Transfer-Encoding: base64',
      '',
      Buffer.from('<html><body><p>邮件正文</p></body></html>').toString('base64'),
      '--fixture',
      'Content-Type: application/octet-stream',
      "Content-Disposition: attachment; filename*=UTF-8''%E6%8A%A5%E8%A1%A8.txt",
      'Content-Transfer-Encoding: base64',
      '',
      Buffer.from('SECRET ATTACHMENT CONTENT').toString('base64'),
      '--fixture--',
      '',
    ].join('\r\n'),
  );
}

for (const extension of ['.eml', '.mht', '.mhtml']) {
  test(`${extension} extracts headers and body and lists attachment names only`, async () => {
    const text = await extract(mime(extension === '.eml' ? 'mixed' : 'related'), extension);
    assert.match(text, /中文邮件/);
    assert.match(text, /张三.*zhang@example\.com/);
    assert.match(text, /li@example\.com/);
    assert.match(text, /邮件正文/);
    assert.match(text, /报表\.txt/);
    assert.doesNotMatch(text, /SECRET ATTACHMENT CONTENT|PHRtb/);
  });
}

test('MSG reads real compound-file properties and embedded attachment names', async () => {
  const cfb = CFB.utils.cfb_new();
  const text = (path, value) => CFB.utils.cfb_add(cfb, path, Buffer.from(`${value}\0`, 'utf16le'));
  text('__substg1.0_0037001F', '中文主题');
  text('__substg1.0_1000001F', '中文正文');
  text('__substg1.0_0C1A001F', '张三');
  text('__substg1.0_0C1F001F', 'zhang@example.com');
  text('__recip_version1.0_#00000000/__substg1.0_3001001F', '李四');
  text('__recip_version1.0_#00000000/__substg1.0_3003001F', 'li@example.com');
  text('__attach_version1.0_#00000000/__substg1.0_3707001F', '附件.txt');
  CFB.utils.cfb_add(
    cfb,
    '__attach_version1.0_#00000000/__substg1.0_37010102',
    Buffer.from('SECRET ATTACHMENT CONTENT'),
  );
  const result = await extract(CFB.write(cfb, { type: 'buffer' }), '.msg');
  for (const value of [
    '中文主题',
    '中文正文',
    '张三',
    'zhang@example.com',
    '李四',
    'li@example.com',
    '附件.txt',
  ])
    assert.ok(result.includes(value), value);
  assert.doesNotMatch(result, /SECRET ATTACHMENT CONTENT/);
});

test('MSG reads RTF-only body instead of silently returning just the subject', async () => {
  const cfb = CFB.utils.cfb_new();
  CFB.utils.cfb_add(cfb, '__substg1.0_0037001F', Buffer.from('RTF subject\0', 'utf16le'));
  const body = Buffer.from(String.raw`{\rtf1\ansi\uc1\u20013?\u25991?}`);
  const header = Buffer.alloc(16);
  header.writeUInt32LE(body.length + 12, 0);
  header.writeUInt32LE(body.length, 4);
  header.writeUInt32LE(0x414c454d, 8); // MS-OXRTFCP MELA: uncompressed RTF.
  CFB.utils.cfb_add(cfb, '__substg1.0_10090102', Buffer.concat([header, body]));
  const result = await extract(CFB.write(cfb, { type: 'buffer' }), '.msg');
  assert.match(result, /RTF subject[\s\S]*中文/);
});

test('MSG with corrupt RTF body propagates the failure', async () => {
  const cfb = CFB.utils.cfb_new();
  CFB.utils.cfb_add(cfb, '__substg1.0_0037001F', Buffer.from('Subject\0', 'utf16le'));
  CFB.utils.cfb_add(cfb, '__substg1.0_10090102', Buffer.from('bad'));
  await assert.rejects(extract(CFB.write(cfb, { type: 'buffer' }), '.msg'), {
    code: 'parse-failed',
  });
});

test('rich readers reject invalid signatures, empty text and output overflow', async () => {
  for (const extension of ['.rtf', '.msg', '.eml', '.mht']) {
    await assert.rejects(extract(Buffer.from('random bytes'), extension), { code: 'unsupported' });
  }
  await assert.rejects(extract(Buffer.from('<html><body></body></html>'), '.html'), {
    code: 'empty',
  });
  await assert.rejects(extract(Buffer.from(`<p>${'汉'.repeat(360000)}</p>`), '.html'), {
    code: 'text-limit',
  });
});
