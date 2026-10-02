'use strict';
const fs = require('node:fs');
const path = require('node:path');
const SOURCES = {
  cli: 'https://x.ai/cli/stable',
  protocol: 'https://agentclientprotocol.com/protocol/v1/schema',
};

async function fetchText(url) {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(30_000),
      headers: { 'User-Agent': 'Grok-Desktop-upstream-check' },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } catch (error) {
    throw new Error(`Public metadata fetch failed: ${url} (${error.message})`);
  }
}
function schemaMetadata(text) {
  // Public v1 schema page exposes canonical wire method names and definition
  // headings. Keep these readable in the baseline; no content hash or code rewrite.
  const normalized = text.replace(/\\\//g, '/').replace(/&#x2[fF];|&#47;/g, '/');
  const methods = new Set(
    normalized.match(/\b(?:session|fs|terminal|elicitation)\/[a-z_]+\b/g) || [],
  );
  for (const name of ['initialize', 'authenticate', 'logout'])
    if (new RegExp(`\\b${name}\\b`).test(normalized)) methods.add(name);
  if (!methods.has('initialize') || !methods.has('session/new') || !methods.has('session/prompt'))
    throw new Error('Official ACP schema metadata could not be parsed. Review the source page.');
  const types = [
    ...new Set(
      [...normalized.matchAll(/<h([2-4])\b(?=[^>]*\bid=)[^>]*>([\s\S]*?)<\/h\1>/g)]
        .map((match) =>
          match[2]
            .replace(/<[^>]*>/g, '')
            .replace(/&[^;]+;/g, '')
            .replace(/[\u200B\uFEFF]/g, '')
            .trim(),
        )
        .filter((value) => /^[A-Z][A-Za-z0-9]+$/.test(value)),
    ),
  ].sort();
  if (!types.includes('InitializeRequest'))
    throw new Error(
      'Official ACP schema definition headings could not be parsed. Review the source page.',
    );
  return { protocolVersion: 1, protocolMethods: [...methods].sort(), protocolTypes: types };
}
async function checkUpstream({
  baseline = require('../docs/upstream-baseline.json'),
  fetchText: read = fetchText,
} = {}) {
  const [versionText, schemaText] = await Promise.all([read(SOURCES.cli), read(SOURCES.protocol)]);
  const cliVersion = versionText.trim();
  if (!/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(cliVersion))
    throw new Error('Official stable CLI version metadata is invalid.');
  const current = { cliVersion, ...schemaMetadata(schemaText) },
    changes = [];
  if (current.cliVersion !== baseline.cliVersion)
    changes.push(`CLI stable version: ${baseline.cliVersion} -> ${current.cliVersion}`);
  for (const field of ['protocolMethods', 'protocolTypes']) {
    if (!baseline[field]) continue;
    const removed = baseline[field].filter((value) => !current[field].includes(value));
    const added = current[field].filter((value) => !baseline[field].includes(value));
    if (added.length) changes.push(`${field} added: ${added.join(', ')}`);
    if (removed.length) changes.push(`${field} removed: ${removed.join(', ')}`);
  }
  return {
    checkedAt: new Date().toISOString(),
    sources: SOURCES,
    ...current,
    changed: changes.length > 0,
    changes,
    scope:
      'Official stable CLI version and public ACP v1 method/type metadata. Field semantics and xAI extensions still require release review.',
  };
}
if (require.main === module) {
  const args = process.argv.slice(2);
  const baselineFile = args.includes('--baseline')
    ? args[args.indexOf('--baseline') + 1]
    : path.join(__dirname, '../docs/upstream-baseline.json');
  const outputFile = args.includes('--output') ? args[args.indexOf('--output') + 1] : null;
  const fixture = args.includes('--fixture') ? args[args.indexOf('--fixture') + 1] : null;
  checkUpstream({
    baseline: JSON.parse(fs.readFileSync(baselineFile, 'utf8')),
    ...(fixture
      ? {
          fetchText: async (url) =>
            fs.readFileSync(
              path.join(fixture, url === SOURCES.cli ? 'stable.txt' : 'schema.html'),
              'utf8',
            ),
        }
      : {}),
  })
    .then((report) => {
      const json = `${JSON.stringify(report, null, 2)}\n`;
      if (outputFile) fs.writeFileSync(outputFile, json);
      process.stdout.write(json);
      if (report.changed) process.exitCode = 2;
    })
    .catch((error) => {
      if (outputFile)
        fs.writeFileSync(
          outputFile,
          `${JSON.stringify({ checkedAt: new Date().toISOString(), sources: SOURCES, changed: null, error: error.message }, null, 2)}\n`,
        );
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    });
}
module.exports = { checkUpstream, schemaMetadata, SOURCES };
