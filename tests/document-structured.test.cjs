const { test } = require('node:test');
const assert = require('node:assert/strict');
const JSZip = require('jszip');
const extract = require('../electron/document-structured.cjs');

const ns =
  'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0"';
const odf = (body, type = 'text') =>
  `<office:document ${ns}><office:styles><text:p>样式不可见</text:p></office:styles><office:body><office:${type}>${body}</office:${type}></office:body></office:document>`;
async function zip(files) {
  const z = new JSZip();
  for (const [name, value] of Object.entries(files)) z.file(name, value);
  return z.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}
const ofd = (body) => `<ofd:OFD xmlns:ofd="http://www.ofdspec.org/2016">${body}</ofd:OFD>`;
const page = (text, extra = '') =>
  `<ofd:Page xmlns:ofd="http://www.ofdspec.org/2016">${extra}<ofd:Content><ofd:Layer><ofd:TextObject><ofd:TextCode>${text}</ofd:TextCode></ofd:TextObject></ofd:Layer></ofd:Content></ofd:Page>`;

test('ODF preserves Chinese inline text, entities, spaces and excludes deleted revisions/styles', async () => {
  const xml = odf(
    '<text:tracked-changes><text:changed-region><text:deletion><text:p>已删除秘密</text:p></text:deletion></text:changed-region></text:tracked-changes><text:h>中文标题</text:h><text:p>甲<text:span>乙&amp;丙</text:span><text:s text:c="2"/>丁<text:tab/>戊<text:line-break/>尾</text:p>',
  );
  for (const ext of ['odt', '.ott', 'fodt']) {
    const bytes = ext === 'fodt' ? Buffer.from(xml) : await zip({ 'content.xml': xml });
    assert.equal(await extract(bytes, ext), '中文标题\n甲乙&丙  丁\t戊\n尾');
  }
});

test('ODP and flat presentation preserve page order and notes', async () => {
  const xml = odf(
    '<draw:page draw:name="第二页"><text:p>中文二</text:p></draw:page><draw:page draw:name="第一页"><text:p>中文一</text:p><office:annotation><text:p>批注</text:p></office:annotation></draw:page>',
    'presentation',
  );
  for (const ext of ['odp', 'otp', 'fodp']) {
    const result = await extract(
      ext === 'fodp' ? Buffer.from(xml) : await zip({ 'content.xml': xml }),
      ext,
    );
    assert.ok(result.indexOf('中文二') < result.indexOf('中文一'));
    assert.doesNotMatch(result, /样式不可见|批注/);
  }
});

test('OFD follows DocRoot and BaseLoc order and includes only referenced templates', async () => {
  const bytes = await zip({
    'OFD.xml': ofd(
      '<ofd:DocBody><ofd:DocRoot>B/Document.xml</ofd:DocRoot></ofd:DocBody><ofd:DocBody><ofd:DocRoot>A/Document.xml</ofd:DocRoot></ofd:DocBody>',
    ),
    'B/Document.xml':
      '<ofd:Document xmlns:ofd="http://www.ofdspec.org/2016"><ofd:CommonData><ofd:TemplatePage ID="9" BaseLoc="Tpl/T.xml"/></ofd:CommonData><ofd:Pages><ofd:Page ID="2" BaseLoc="Pages/P2.xml"/><ofd:Page ID="1" BaseLoc="/B/Pages/P1.xml"/></ofd:Pages></ofd:Document>',
    'B/Pages/P1.xml': page('金额：壹佰元 &amp; ¥100'),
    'B/Pages/P2.xml': page('购买方：测试公司', '<ofd:Template TemplateID="9"/>'),
    'B/Tpl/T.xml': page('电子发票'),
    'B/Pages/unused.xml': page('未引用旧页面'),
    'A/Document.xml':
      '<ofd:Document xmlns:ofd="http://www.ofdspec.org/2016"><ofd:Pages><ofd:Page ID="1" BaseLoc="P.xml"/></ofd:Pages></ofd:Document>',
    'A/P.xml': page('附件文档'),
  });
  const result = await extract(bytes, 'ofd');
  assert.ok(result.indexOf('电子发票') < result.indexOf('购买方'));
  assert.ok(result.indexOf('购买方') < result.indexOf('金额'));
  assert.ok(result.indexOf('金额') < result.indexOf('附件文档'));
  assert.match(result, /壹佰元 & ¥100/);
  assert.doesNotMatch(result, /未引用旧页面/);
});

test('structured documents reject corrupt XML, missing references and unknown formats', async () => {
  await assert.rejects(extract(Buffer.from(odf('<text:p>破损')), 'fodt'), { code: 'parse-failed' });
  await assert.rejects(
    extract(
      await zip({
        'OFD.xml': ofd('<ofd:DocBody><ofd:DocRoot>missing.xml</ofd:DocRoot></ofd:DocBody>'),
      }),
      'ofd',
    ),
    { code: 'parse-failed' },
  );
  await assert.rejects(extract(Buffer.from('binary'), 'caj'), { code: 'unsupported' });
  await assert.rejects(extract(Buffer.from(odf('')), 'fodt'), { code: 'empty' });
});

test('structured XML supports UTF-16 and bounds actual text expansion', async () => {
  const xml = '<?xml version="1.0" encoding="UTF-16"?>' + odf('<text:p>中文𠮷</text:p>');
  assert.equal(
    await extract(Buffer.concat([Buffer.from([255, 254]), Buffer.from(xml, 'utf16le')]), 'fodt'),
    '中文𠮷',
  );
  await assert.rejects(
    extract(Buffer.from(odf('<text:p><text:s text:c="1048577"/></text:p>')), 'fodt'),
    { code: 'text-limit' },
  );
  await assert.rejects(
    extract(Buffer.from(odf(`<text:p>${'中'.repeat(350000)}</text:p>`)), 'fodt'),
    { code: 'text-limit' },
  );
});

test('EPUB reads XHTML in OPF spine order, without scripts or unlisted chapters', async () => {
  const bytes = await zip({
    'META-INF/container.xml':
      '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="Book/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
    'Book/package.opf':
      '<package xmlns="http://www.idpf.org/2007/opf"><manifest><item id="one" href="第一章.xhtml" media-type="application/xhtml+xml"/><item id="two" href="second.xhtml" media-type="application/xhtml+xml"/><item id="old" href="old.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="two"/><itemref idref="one"/></spine></package>',
    'Book/第一章.xhtml':
      '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>重复标题</title><style>CSS秘密</style></head><body><h1>第一章</h1><p>甲<strong>乙</strong>&amp;丙</p><script>脚本秘密</script></body></html>',
    'Book/second.xhtml':
      '<html xmlns="http://www.w3.org/1999/xhtml"><body><h1>第二章</h1><p>先读这里</p></body></html>',
    'Book/old.xhtml':
      '<html xmlns="http://www.w3.org/1999/xhtml"><body><p>旧章节</p></body></html>',
  });
  const result = await extract(bytes, 'epub');
  assert.ok(result.indexOf('第二章') < result.indexOf('第一章'));
  assert.match(result, /甲乙&丙/);
  assert.doesNotMatch(result, /旧章节|脚本秘密|CSS秘密|重复标题/);
});

test('EPUB rejects encrypted chapter text and OFD image-only files return empty', async () => {
  const epub = await zip({
    'META-INF/container.xml':
      '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
    'book.opf':
      '<package xmlns="http://www.idpf.org/2007/opf"><manifest><item id="a" href="a.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="a"/></spine></package>',
    'META-INF/encryption.xml':
      '<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container" xmlns:e="http://www.w3.org/2001/04/xmlenc#"><e:EncryptedData><e:CipherData><e:CipherReference URI="a.xhtml"/></e:CipherData></e:EncryptedData></encryption>',
    'a.xhtml': 'encrypted bytes',
  });
  await assert.rejects(extract(epub, 'epub'), { code: 'unsupported' });
  const imageOnly = await zip({
    'OFD.xml': ofd('<ofd:DocBody><ofd:DocRoot>Document.xml</ofd:DocRoot></ofd:DocBody>'),
    'Document.xml':
      '<ofd:Document xmlns:ofd="http://www.ofdspec.org/2016"><ofd:Pages><ofd:Page ID="1" BaseLoc="P.xml"/></ofd:Pages></ofd:Document>',
    'P.xml':
      '<ofd:Page xmlns:ofd="http://www.ofdspec.org/2016"><ofd:Content><ofd:Layer><ofd:ImageObject ResourceID="1"/></ofd:Layer></ofd:Content></ofd:Page>',
  });
  await assert.rejects(extract(imageOnly, 'ofd'), { code: 'empty' });
});

test('EPUB2 permits inert XHTML declarations and standard entities, rejects custom entity declarations', async () => {
  async function book(chapter) {
    return zip({
      'META-INF/container.xml':
        '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
      'book.opf':
        '<package xmlns="http://www.idpf.org/2007/opf"><manifest><item id="a" href="a.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="a"/></spine></package>',
      'a.xhtml': chapter,
    });
  }
  const body =
    '<html xmlns="http://www.w3.org/1999/xhtml"><body><p>中文&nbsp;标题&mdash;正文</p></body></html>';
  const declaration =
    '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">';
  assert.equal(await extract(await book(declaration + body), 'epub'), '中文\u00a0标题—正文');
  await assert.rejects(
    extract(await book('<!DOCTYPE html [<!ENTITY mine "custom">]>' + body), 'epub'),
    { code: 'unsupported' },
  );
  await assert.rejects(extract(await book(body.replace('&nbsp;', '&unknownCustom;')), 'epub'), {
    code: 'parse-failed',
  });
});
