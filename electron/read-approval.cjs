'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { isDeepStrictEqual } = require('node:util');

const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value) => typeof value === 'string' && value.length > 0 && !value.includes('\0');
const onlyKeys = (value, keys) => Object.keys(value).every((key) => keys.includes(key));
const optional = (value, check) => value == null || check(value);
const integer = (value) => Number.isSafeInteger(value);
const unsigned = (value) => integer(value) && value >= 0;

// Evidence: official xai-org/grok-build 2bdd1d6a normalization.rs and
// scripts/verify-cli-read-policy.cjs (real CLI, local synthetic model).
// The CLI stamps this envelope from registered tool metadata, not the title.
// Other namespaces, versions and toolsets need their own verified contract.
function readApprovalPaths(toolCall, cwd) {
  if (!object(toolCall) || !text(cwd) || !path.isAbsolute(cwd)) return null;
  const meta = toolCall._meta?.['x.ai/tool'];
  const raw = toolCall.rawInput;
  if (
    !object(meta) ||
    !object(raw) ||
    !object(meta.input) ||
    meta.version !== 1 ||
    meta.namespace !== 'grok_build' ||
    meta.read_only !== true ||
    (toolCall.name != null && toolCall.name !== meta.name) ||
    !onlyKeys(toolCall._meta, ['x.ai/tool']) ||
    !onlyKeys(meta, ['version', 'name', 'kind', 'namespace', 'label', 'read_only', 'input']) ||
    (Array.isArray(toolCall.content) &&
      toolCall.content.some((item) => item?.type === 'diff' || item?.type === 'terminal'))
  )
    return null;

  let target;
  /** @type {Record<string, unknown>} */
  let canonical;
  if (meta.name === 'read_file') {
    if (
      meta.kind !== 'read' ||
      toolCall.kind !== 'read' ||
      raw.variant !== 'ReadFile' ||
      !onlyKeys(raw, ['variant', 'target_file', 'offset', 'limit', 'pages', 'format']) ||
      !text(raw.target_file) ||
      !optional(raw.offset, integer) ||
      !optional(raw.limit, unsigned) ||
      !optional(raw.pages, text) ||
      !optional(raw.format, (value) => ['text', 'image'].includes(value))
    )
      return null;
    target = raw.target_file;
    canonical = { path: target };
    if (raw.offset != null && raw.offset >= 0) canonical.offset = Math.max(1, raw.offset);
    if (raw.limit != null) canonical.limit = raw.limit;
  } else if (meta.name === 'grep') {
    // The official grep runner honors rg's user config, which may enable
    // symlink following or --pre. Its ACP identity does not expose that config.
    if (process.env.RIPGREP_CONFIG_PATH) return null;
    if (
      meta.kind !== 'search' ||
      toolCall.kind !== 'search' ||
      raw.variant !== 'Grep' ||
      !onlyKeys(raw, [
        'variant',
        'pattern',
        'path',
        'glob',
        'output_mode',
        '-B',
        '-A',
        '-C',
        '-i',
        'type',
        'head_limit',
        'multiline',
      ]) ||
      !text(raw.pattern) ||
      !optional(raw.path, text) ||
      !optional(raw.glob, text) ||
      !optional(raw.type, text) ||
      !optional(raw.output_mode, (value) =>
        ['content', 'files_with_matches', 'count'].includes(value),
      ) ||
      !['-B', '-A', '-C', 'head_limit'].every((key) => optional(raw[key], unsigned)) ||
      !['-i', 'multiline'].every((key) => optional(raw[key], (value) => typeof value === 'boolean'))
    )
      return null;
    target = raw.path ?? '.';
    canonical = { pattern: raw.pattern, ...(raw.path != null ? { path: raw.path } : {}) };
  } else if (meta.name === 'list_dir') {
    if (
      meta.kind !== 'list' ||
      toolCall.kind !== 'other' ||
      raw.variant !== 'ListDir' ||
      !onlyKeys(raw, ['variant', 'target_directory']) ||
      !text(raw.target_directory)
    )
      return null;
    target = raw.target_directory;
    canonical = { directory: target };
  } else return null;
  if (!isDeepStrictEqual(meta.input, canonical)) return null;
  return [path.resolve(cwd, target)];
}

// No supplied authorization callback means only existing targets whose real
// paths stay in this project. A lexical prefix alone cannot authorize a link.
async function authorizeProjectRead({ cwd, paths }) {
  try {
    const root = await fs.realpath(cwd);
    for (const target of paths) {
      const relative = path.relative(root, await fs.realpath(target));
      if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
        return false;
    }
    return paths.length > 0;
  } catch {
    return false;
  }
}

module.exports = { readApprovalPaths, authorizeProjectRead };
