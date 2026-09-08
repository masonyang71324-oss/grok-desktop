# Desktop workflows implementation plan

**Goal:** Implement all six approved functional upgrades while preserving stable defaults, then apply compatible maintenance patches.

**Architecture:** Independently testable session runtime, checkpoint store, project runner and renderer controls. Existing GrokClient remains the per-connection ACP implementation. Electron IPC composes services.

**Tech Stack:** Electron, Node 22, React, TypeScript 5, Vite 6, node:test and Playwright.

**Spec:** ../specs/2026-09-08-desktop-workflows.md

## Global Constraints

- Windows Electron desktop; retain existing Chinese and English interfaces.
- Preserve existing approvals, drafts, history, file newline handling, unsaved-editor protection and settings.
- No live model prompts in tests; use isolated mock ACP processes and temporary workspaces.
- No automatic replay of interrupted prompts or destructive file restoration.
- No upgrade of TypeScript, Node types or Vite major versions solely for novelty.
- Develop in the isolated 1.3.0 worktree; ship new versioned artifacts, retain 1.2.1 artifacts.

## Task 1: Session runtime and recovery

Own electron/main.cjs, new electron/session-hub.cjs, electron/background.cjs and targeted runtime tests. Preserve acp.cjs attachment code for parent work. Consume GrokClient, provide session methods plus IPC contracts in spec. Test two fake ACP clients producing the same permission ID, independent cancellation, same-directory serialization, FIFO queues, error-paused queues and live snapshot restoration. Implement runtime hub, wire main process, then run runtime and lifecycle tests. Root wires workspace and attachments into main after this task.

## Task 2: Workspace changes and project execution

Own new electron/checkpoints.cjs, electron/project-runner.cjs and targeted tests. Export createCheckpointStore({directory}) with begin({cwd,sessionId,turnId}), finish(id), list({cwd,sessionId}), detail({id}), restore({id,paths}); provide exact return shapes from spec. Export createProjectRunner({emit}) with inspect/start/stop/state/dispose. Begin records current file contents including dirty/untracked files, finish records after-state, restore refuses later modifications. Bound files/storage and exclude dependency/build directories. Tests use temporary real files and owned child process fixtures. Root performs IPC/turn lifecycle wiring.

## Task 3: Usable frontend controls

Own src/App.tsx, src/Inspector.tsx, new src/TaskCenter.tsx, src/ProjectTools.tsx, src/workflows.css, src/types.ts and frontend tests. Root owns translations in a new locale file. Implement switching during runs, global task center, queued sending and per-session approvals; context selection and inspectable attachment tray; image paste; checkpoint review/restore confirmation; detected script run/stop/restart and preview; categorized recovery with explicit interrupted task status. Follow exact IPC contracts and existing translation function. No unsafe automatic resubmit. Report all new Chinese translation keys.

## Task 4: Integration, attachments and maintenance

Parent owns acp attachment preparation, preload command allowlist, reusable error classification, new translations, package metadata, CI and Dependabot. Test supported image payload and unsupported capability refusal before send. Connect checkpoint begin/finish hooks and project runner IPC after Task 1 main edits land. Update compatible DOMPurify/marked patches, GitHub actions and group Vite dependency proposals. Version 1.3.0. Run complete checks and real Electron workflow E2E with isolated data; fix meaningful failures and obtain independent final review.

## Progress

- [x] Baseline
- [x] Session runtime
- [x] Workspace services
- [x] Frontend workflows
- [x] Integration and maintenance
- [x] Source and packaged verification
- [x] Final review and delivery

Verification: 154 tests pass; production build and formatting pass. All four real Electron E2E scripts pass against source and the packaged 1.3.0 executable. Independent review findings were reproduced and fixed with targeted regressions: rejected sends, active timeline restoration, background directory locks and workflow controls, checkpoint shutdown, and session-scoped subagent cancellation.
