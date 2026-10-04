const { translate: t } = require('./i18n.cjs');

/** @typedef {{cwd: string, sessionId: string, turnId: string}} CheckpointTurn */
/**
 * @param {{
 * store: Pick<ReturnType<typeof import('./checkpoints.cjs').createCheckpointStore>, 'begin' | 'finish'>,
 * chooseWithoutCheckpoint?: (input: CheckpointTurn & {error: Error & {code?: string}}) => boolean | Promise<boolean>,
 * emit?: (event: {type: 'checkpoints-changed', cwd: string, sessionId: string}) => void
 * }} options
 */
function createCheckpointTurnHooks({ store, chooseWithoutCheckpoint, emit = () => {} }) {
  /** @type {Map<string, {checkpointId?: string, checkpointSkipped?: boolean}>} */
  const turns = new Map();
  return {
    /** @param {CheckpointTurn & {payload?: {text?: string}}} turn */
    async beforeTurn({ cwd, sessionId, turnId, payload }) {
      try {
        const summary =
          typeof payload?.text === 'string'
            ? [...payload.text.trim().replace(/\s+/g, ' ')].slice(0, 160).join('')
            : undefined;
        const id = await store.begin({ cwd, sessionId, turnId, ...(summary ? { summary } : {}) });
        turns.set(turnId, { checkpointId: id });
      } catch (error) {
        if (error.code !== 'CHECKPOINT_STORAGE_FULL') throw error;
        if (!chooseWithoutCheckpoint) throw error;
        if ((await chooseWithoutCheckpoint({ cwd, sessionId, turnId, error })) !== true)
          throw Object.assign(new Error(t('已取消发送。')), { code: 'CHECKPOINT_CANCELLED' });
        turns.set(turnId, { checkpointSkipped: true });
      }
    },
    /** @param {CheckpointTurn} turn */
    async afterTurn({ cwd, sessionId, turnId }) {
      const result = turns.get(turnId);
      if (!result) return;
      try {
        if (result.checkpointId) await store.finish(result.checkpointId);
        emit({ type: 'checkpoints-changed', cwd, sessionId });
        return result;
      } finally {
        turns.delete(turnId);
      }
    },
  };
}

module.exports = { createCheckpointTurnHooks };
