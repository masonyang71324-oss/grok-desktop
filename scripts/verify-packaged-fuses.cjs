const assert = require('node:assert/strict');
const path = require('node:path');

async function verifyPackagedFuses(executable) {
  const { getCurrentFuseWire, FuseV1Options, FuseState } = await import('@electron/fuses');
  const wire = await getCurrentFuseWire(executable);
  const expected = {
    RunAsNode: false,
    EnableNodeOptionsEnvironmentVariable: false,
    EnableNodeCliInspectArguments: true,
    EnableEmbeddedAsarIntegrityValidation: true,
    OnlyLoadAppFromAsar: true,
  };
  const result = {};
  for (const [name, enabled] of Object.entries(expected)) {
    const actual = wire[FuseV1Options[name]];
    assert.equal(
      actual,
      enabled ? FuseState.ENABLE : FuseState.DISABLE,
      `${name} in the packaged executable`,
    );
    result[name] = enabled;
  }
  return { executable: path.resolve(executable), fuses: result };
}

if (require.main === module) {
  const executable = process.argv[2];
  if (!executable) {
    console.error('Usage: node scripts/verify-packaged-fuses.cjs <packaged executable>');
    process.exitCode = 1;
  } else {
    verifyPackagedFuses(executable)
      .then((result) => console.log(JSON.stringify(result, null, 2)))
      .catch((error) => {
        console.error(error.message);
        process.exitCode = 1;
      });
  }
}
module.exports = { verifyPackagedFuses };
