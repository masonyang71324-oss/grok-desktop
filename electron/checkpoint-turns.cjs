const { translate: t } = require('./i18n.cjs');

function createCheckpointTurnHooks({ store, chooseWithoutCheckpoint, emit = () => {} }) {
  const turns = new Map();
  return {
    async beforeTurn({ cwd, sessionId, turnId }) {
      try {
        const id = await store.begin({ cwd, sessionId, turnId });
        turns.set(turnId, { checkpointId: id });
      } catch (error) {
        if (error.code !== 'CHECKPOINT_STORAGE_FULL') throw error;
        if (!chooseWithoutCheckpoint) throw error;
        if ((await chooseWithoutCheckpoint({ cwd, sessionId, turnId, error })) !== true)
          throw Object.assign(new Error(t('已取消发送。')), { code: 'CHECKPOINT_CANCELLED' });
        turns.set(turnId, { checkpointSkipped: true });
      }
    },
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
