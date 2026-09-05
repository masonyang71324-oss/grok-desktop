const storageKey = 'grok-desktop-drafts';
const projectKey = (cwd) => cwd.replaceAll('\\', '/').replace(/\/$/, '').toLowerCase();
const keyFor = (cwd, sessionId) => JSON.stringify([projectKey(cwd), sessionId || '']);
const emptyDraft = () => ({ text: '', attachments: [] });

export function sameDraft(left, right) {
  return (
    left.text === right.text &&
    left.attachments.length === right.attachments.length &&
    left.attachments.every(
      (file, index) =>
        file.path === right.attachments[index].path && file.name === right.attachments[index].name,
    )
  );
}

export function createDraftStore(storage, onError = () => {}) {
  let state = { drafts: {}, selected: {}, summaries: {} };
  let timer;
  try {
    const saved = JSON.parse(storage?.getItem(storageKey) || 'null');
    if (saved?.drafts && saved?.selected) state = { ...saved, summaries: saved.summaries || {} };
  } catch {
    onError();
  }
  const write = () => {
    clearTimeout(timer);
    timer = undefined;
    try {
      storage?.setItem(storageKey, JSON.stringify(state));
    } catch {
      onError();
    }
  };
  const remember = (cwd, sessionId, title) => {
    const key = keyFor(cwd, sessionId);
    state.summaries[key] = {
      ...state.summaries[key],
      cwd,
      sessionId,
      title: title || state.summaries[key]?.title || '',
    };
  };
  return {
    flush: write,
    read(cwd, sessionId) {
      const value = state.drafts[keyFor(cwd, sessionId)];
      return typeof value?.text === 'string' && Array.isArray(value.attachments)
        ? structuredClone(value)
        : emptyDraft();
    },
    save(cwd, sessionId, draft, deferred = false) {
      const key = keyFor(cwd, sessionId);
      if (draft.text || draft.attachments.length) state.drafts[key] = structuredClone(draft);
      else delete state.drafts[key];
      if (sessionId)
        state.summaries[key] = {
          ...state.summaries[key],
          cwd,
          sessionId,
          title: state.summaries[key]?.title || '',
          updatedAt: new Date().toISOString(),
        };
      if (deferred) {
        clearTimeout(timer);
        timer = setTimeout(write, 300);
      } else write();
    },
    selected(cwd) {
      return state.selected[projectKey(cwd)] || '';
    },
    remember(cwd, sessionId, title) {
      remember(cwd, sessionId, title);
      write();
    },
    merge(cwd, sessions) {
      // Grok can omit an empty inactive session even though session/load still accepts it.
      // Official entries win; local draft metadata only supplies omitted sessions.
      const merged = sessions.map((session) => ({ ...session }));
      const seen = new Set(sessions.map((session) => session.sessionId));
      for (const session of sessions)
        remember(session.cwd || cwd, session.sessionId, session.title);
      for (const [key, draft] of Object.entries(state.drafts)) {
        const [project, sessionId] = JSON.parse(key);
        if (
          project !== projectKey(cwd) ||
          !sessionId ||
          seen.has(sessionId) ||
          (!draft.text && !draft.attachments?.length)
        )
          continue;
        merged.push({
          ...(state.summaries[key] || { cwd, sessionId, title: '' }),
        });
        seen.add(sessionId);
      }
      write();
      return merged.sort(
        (a, b) =>
          (Date.parse(b.updatedAt || b.createdAt) || 0) -
          (Date.parse(a.updatedAt || a.createdAt) || 0),
      );
    },
    select(cwd, sessionId) {
      if (!cwd) return;
      state.selected[projectKey(cwd)] = sessionId || '';
      write();
    },
    remove(cwd, sessionId) {
      delete state.drafts[keyFor(cwd, sessionId)];
      delete state.summaries[keyFor(cwd, sessionId)];
      if (state.selected[projectKey(cwd)] === sessionId) delete state.selected[projectKey(cwd)];
      write();
    },
  };
}
