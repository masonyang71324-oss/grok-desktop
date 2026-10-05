# Five usability improvements

Baseline: 1.8.1 / 0609424. The user approved all five priorities on 2026-10-05. Preserve simplicity, stable behavior, bilingual UI, complete existing functionality and native project trust. This is an incremental change to existing flows, not a framework or agent rewrite.

## Design and implementation

1. Session list: derive status from owned main-process task snapshots; show awaiting approval before running, finishing/background, paused/interrupted/error, queued count and unsent draft. Draft presence is metadata, never prompt text. Keep virtualized list navigation and current session selection. Task center defaults to actionable/active items, groups items needing attention first, and offers an explicit view of all history; idle is not labelled as pending execution.
2. Approval dialog: show structured file diffs using the existing viewer, plus an explicit working directory and recognizable destructive-command explanation. Keep original command/arguments and every official permission option available with the same IDs. Do not infer a new auto-approval policy. Unknown tool shapes retain readable details.
3. File/system errors: map recognizable EPERM/EACCES, EBUSY, ENOSPC and ENOENT errors to localized explanations and a useful next action. Preserve the original details, avoid describing every permission failure as a lock, and keep auth/quota/connection classification. Unknown errors remain inspectable.
4. Appearance: expose a persistent interface-size setting, immediately applied to the desktop's main webContents and restored at launch; preserve keyboard/menu zoom behavior consistently. Improve small important UI text to at least 12px without mechanically resizing icons/decorations. Verify normal and enlarged Chinese/English layouts at a small supported window.
5. Navigation: system-notification clicks identify the originating session and approval request; use existing navigation and preserve dirty editors/drafts. Dropping one folder asks to open it as a project through native confirmation/trust. Files remain attachments; mixed/multiple-folder drops get a clear choice or explanation and do not silently discard files or change projects. Native drop grants remain unavailable to arbitrary renderer pathname requests.

## Ownership

- Task-state agent: SessionList, TaskCenter, draft presence metadata, dedicated status helper/styles/tests.
- Approval agent: approval rendering and its helper/styles/tests; keep SettingsDialog separate.
- Presentation/error agent: error explanation/details component, appearance settings component, size normalization/application helper and focused styles/tests; root integrates shared App/main/settings/type/locale registration points.
- Root: native folder-drop and notification navigation, shared integration, representative Electron tests, version/docs/release.

## Review focus and verification

- Different sessions with identical permission IDs must navigate and approve only the originating session; pending load/dirty editor must not discard input.
- Native file drops still preserve original draft ownership; folder cancel and read-only trust must not start a task or gain write authority.
- Task status and draft chips stay accurate after completion, switching sessions and clearing/sending drafts; existing task stop/resume actions stay available.
- Approval diff and command preview retain full raw input and permission option IDs; risk labels cannot silently deny or grant execution.
- Error translation retains original diagnostics; UI size survives restart and remains usable without clipped controls in both languages.

Use focused behavior regressions for these boundaries, then one integrated unit/type/lint/build run and real source/packaged Electron flows. Repeat only after relevant changes or observed failures. Publish a new version and install the public release artifact after verifying the current installed app is idle and can close normally. Preserve raw verification evidence locally.

## Verification record

- 550 unit/component/native-boundary tests passed, zero skipped; backend type/lint and production build passed.
- All source desktop scenarios passed. Legacy smoke/workflow expectations were updated for the additive zoom setting and intentional task-history filter; image failures now assert the readable explanation and expanded original details.
- The packaged five-group flow passed, including actual native directory File drops, cancellation/read-only trust, origin-scoped notification navigation, raw error copying, and zoom restart persistence. Packaged runtime fuses were inspected.
- Independent review found stale project trust on cross-project notification navigation. The destination now goes through project.open, updates project trust/watching/preferences, and loads the requested session without restoring an unrelated last session; the regression passed.
- Native 980×700 at 125% has usable Chinese/English navigation and history space (110px/88px). The latest-message button is confined to the message viewport and does not cover the composer. Native Ctrl+0/Ctrl++ restore/adjust and persist zoom.
- Source/packaged screenshots and raw logs are retained in local test-results. Notification factory clicks are unit-tested; actual Electron event-to-conversation navigation is covered end to end.
