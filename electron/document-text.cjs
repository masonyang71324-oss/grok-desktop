'use strict';
function decodeText(bytes) {
  if (bytes[0] === 255 && bytes[1] === 254)
    return new TextDecoder('utf-16le', { fatal: true }).decode(bytes.subarray(2));
  if (bytes[0] === 254 && bytes[1] === 255)
    return new TextDecoder('utf-16be', { fatal: true }).decode(bytes.subarray(2));
  if (bytes.includes(0)) throw Object.assign(new Error('Binary input'), { code: 'unsupported' });
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('gb18030', { fatal: true }).decode(bytes);
  }
}
module.exports = { decodeText };
