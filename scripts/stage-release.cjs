const fs = require('node:fs/promises');
const path = require('node:path');

const releaseTag = /^v((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(-beta\.(?:0|[1-9]\d*))?)$/;

function releaseInfo(tag, packageVersion) {
  const match = typeof tag === 'string' && tag.match(releaseTag);
  if (!match) throw new Error('Release tag must be vX.Y.Z or vX.Y.Z-beta.N.');
  const version = match[1];
  if (packageVersion !== undefined && packageVersion !== version) {
    throw new Error(`Release tag ${tag} does not match package version ${packageVersion}.`);
  }
  const prerelease = !!match[2];
  const channel = prerelease ? 'beta' : 'latest';
  return { version, channel, manifest: `${channel}.yml`, prerelease };
}

// Operate on electron-builder's generated root scalars instead of reserializing
// YAML: installer URLs, hashes, sizes, release notes and formatting remain exact.
function setStagingPercentage(source, tag, filename, percentage) {
  const release = releaseInfo(tag);
  if (filename !== release.manifest) {
    throw new Error(`Release channel ${release.channel} requires ${release.manifest}.`);
  }
  if (!/^\d+$/.test(String(percentage)) || Number(percentage) > 100) {
    throw new Error('Staging percentage must be an integer from 0 to 100.');
  }
  const versions = [...source.matchAll(/^version:[^\r\n]*/gm)];
  const value =
    versions.length === 1 &&
    versions[0][0].match(/^version:[ \t]*(?:"([^"]+)"|'([^']+)'|([^ \t#]+))[ \t]*(?:#.*)?$/);
  if (!value || (value[1] || value[2] || value[3]) !== release.version) {
    throw new Error(`Manifest version must match release ${release.version}.`);
  }
  const existing = [...source.matchAll(/^stagingPercentage:[^\r\n]*/gm)];
  if (existing.length > 1) throw new Error('Manifest contains multiple stagingPercentage values.');
  const normalized = String(Number(percentage));
  if (existing.length) {
    const match = existing[0];
    const scalar = match[0].match(/^(stagingPercentage:[ \t]*)\d+([ \t]*(?:#.*)?)$/);
    if (!scalar) throw new Error('Manifest stagingPercentage must be a numeric root scalar.');
    return (
      source.slice(0, match.index) +
      scalar[1] +
      normalized +
      scalar[2] +
      source.slice(match.index + match[0].length)
    );
  }
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  // electron-builder emits one document. Place an added scalar before an
  // optional explicit document end, preserving every original byte.
  const documentEnd = /^\.\.\.[ \t]*(?:#[^\r\n]*)?(?:\r?\n)?$/m.exec(source);
  const index = documentEnd ? documentEnd.index : source.length;
  const prefix = source.slice(0, index);
  return (
    prefix +
    (prefix.endsWith('\n') ? '' : newline) +
    `stagingPercentage: ${normalized}${newline}` +
    source.slice(index)
  );
}

async function main(args) {
  const [command, ...values] = args;
  if (command === 'info' && (values.length === 1 || values.length === 2)) {
    console.log(JSON.stringify(releaseInfo(...values)));
  } else if (command === 'set' && values.length === 3) {
    const [filename, tag, percentage] = values;
    const source = await fs.readFile(filename, 'utf8');
    const result = setStagingPercentage(source, tag, path.basename(filename), percentage);
    await fs.writeFile(filename, result, 'utf8');
    console.log(`${path.basename(filename)}: ${tag}, stagingPercentage=${Number(percentage)}`);
  } else {
    throw new Error(
      'Usage: stage-release.cjs info <tag> [package-version] | set <manifest> <tag> <percentage>',
    );
  }
}

if (require.main === module)
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });

module.exports = { releaseInfo, setStagingPercentage };
