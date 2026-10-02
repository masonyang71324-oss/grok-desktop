# Sixteen upgrades implementation plan

> **For agentic workers:** Use superpowers:subagent-driven-development for independent implementation and review. Root owns integration and release.

**Goal:** Deliver all sixteen approved practical improvements without losing stable, simple operation.

**Architecture:** Extend the existing React UI and explicit Electron IPC. Isolated modules own conversation, files, runtime services, terminal and preview; current ACP/session/draft boundaries remain authoritative.

**Tech Stack:** Electron 44, React 19, TypeScript/Vite, Node 22+, local KaTeX, docx-preview, node-pty and xterm; existing SheetJS/JSZip for Office models.

**Spec:** `docs/superpowers/specs/2026-10-03-sixteen-upgrades-design.md`.

## Global constraints

- Windows, Chinese and English, original feature set retained.
- No paid model requests, production credentials/config edits, or user-file mutation during tests.
- No restricted competitor code/assets copied.
- Heavy viewers/terminal load on demand; preserve async session/cwd ownership and all `docs/reliability.md` guarantees.

## Review focus

- Late search/preview/attachment results must not alter a different session or draft (workspace and integration tests).
- Incomplete markup, formulas and Office layout must remain readable without making data editable (conversation/Office tests).
- Cancel/timeout/close must settle once and stop owned installation/terminal processes (runtime/terminal tests).
- Idle collection must exclude background/finalizing work and reload the original identity (session-hub tests).
- Small windows, IME, resizing and multilingual labels must preserve send/stop and keyboard use (integrated E2E).

## A. Conversation (1, 2, 3, 11, 14)

Files: new `src/ConversationNavigation.tsx`, `src/conversation-navigation.mjs`, dedicated locale/CSS, modify `src/components.tsx`, `src/markdown-dom.ts`, add parser/math helpers and `scripts/bench-conversation.cjs`. Tests: focused navigation/rendering/math and long-conversation browser behavior.

Interfaces: navigation consumes `{sessionId, rows, turnError, onNavigate}`; target is `{kind:'row',rowId}` or `{kind:'error'}`. Message roots expose `data-row-id`. Formatted copy sends `{text,html}` through existing `clipboard.write`. Root provides jump expansion/scroll behavior and toolbar entry.

- [ ] Write and run failing tests for Chinese/tool/error hits, outline attachment titles, exact source copying and math/code/currency boundaries.
- [ ] Implement navigation + formatting and local math; add translations; run focused tests.
- [ ] Benchmark 100/500 messages + streamed tail, apply measured retained-DOM/parse improvement, verify selection/scroll/jump.
- [ ] Review module diff and report exact integration needs.

## B. Workspace (5, 6, 7, 13)

Files: `src/diff-model.mjs`, `src/DiffViewer.tsx`, modify `src/Inspector.tsx` and `electron/workspace.cjs`; new `ProjectFilePicker.tsx`, `OfficePreview.tsx`, `ResizeHandle.tsx`, `electron/office-preview.cjs` and worker, dedicated locales/CSS/tests. Root owns App/settings wiring.

Interfaces: `workspace.search({cwd,query,limit:100}) -> {files:Attachment[],truncated}`; `office.preview({path})` returns a typed readonly model with kind, notice and format-specific data. Diff receives raw text only. Resize handle passes constrained pixel values and commit callback.

- [ ] Write failing tests for multi-hunk diff, hidden/limited file search and supported Office models including uncached formula.
- [ ] Implement readable diff, scoped picker, readonly viewers and keyboard/pointer resizing; run focused tests.
- [ ] Verify legacy/complex format limitations, zero write-back, root integration contracts.

## C. Runtime (4, 10, 12, 15)

Files: `electron/cli-installer.cjs`, `electron/providers.cjs`, `electron/session-hub.cjs`, `electron/acp.cjs` as needed, `src/FirstRunWizard.tsx`, `src/ProviderSettings.tsx`, `scripts/check-upstream.cjs`, workflow/baseline/locales/tests. No writes to real configuration during development.

Interfaces: installer state/start/cancel, public provider list/save/remove with text-baseline conflict detection, session idle collector with explicit protected-state predicate and lazy reactivation; wizard/provider components use dedicated request commands root registers.

- [ ] Write failing install cancellation/version verification, TOML preservation/conflict/secret omission, idle protection/reactivation and offline upstream fixture tests.
- [ ] Implement official installer and forms, idle lifecycle and upstream check; verify isolated fixtures.
- [ ] Document supported official schema/source URLs and root command/event/type contracts.

## D. Terminal, preview, dictation (8, 9, 16)

Files: new `electron/terminal.cjs`, `electron/web-preview.cjs`, `electron/dictation.cjs`, `src/TerminalPanel.tsx`, `src/WebPreview.tsx`, `src/locales/desktop-tools.ts`, tests; root main/preload/types integration.

Interfaces: terminal open/input/resize/close/state using explicit terminal id and cwd; preview open/navigate/state/capture/close using explicit preview identity and original draft owner. Capture returns a standard image Attachment. Dictation launches only the Windows hotkey after composer focus.

- [ ] Write lifecycle/input/invalid-URL/screenshot-owner tests and isolated native PTY smoke.
- [ ] Implement ConPTY/xterm and isolated visible web preview, preserving external open options and truthful status.
- [ ] Implement dictation launcher and button with system-managed state; test generated key sequence via injected executor, not real microphone.

## E. Integration and delivery

- [ ] Wire lazy components, all request allowlists/handlers, locale maps, settings sizes and scoped attachment/preview actions in App/main/preload/types.
- [ ] Add mock Electron end-to-end coverage for new UI in both languages, resize/IME, capture-to-correct-draft, onboarding/provider forms and real terminal output.
- [ ] Run focused regressions, then full tests/format/build/source E2E. Review whole changeset; fix demonstrated failures.
- [ ] Build installer/portable and run packaged E2E/native-module smoke, visually inspect Chinese/English/small-window layouts.
- [ ] Document all sixteen actual implementations and limitations, version release, publish and safely update local installed app after idle check.
