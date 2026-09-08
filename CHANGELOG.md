# Changes

## 1.3.0

- Add per-conversation background connections, a task center and persistent message queues. Serialize writes in the same project and pause queues on cancellation, interruption or error.
- Preserve running tasks and pending approvals across interface reloads. Route approval IDs by conversation and provide targeted recovery actions without automatic resubmission.
- Record bounded per-turn file checkpoints, review changes, restore selected files with conflict checks, undo restores and remove old recovery records.
- Attach selected code, whole files and Git diffs; inspect attachments before sending. Support native image payloads and clipboard screenshots only when the CLI advertises image input.
- Add npm script discovery, run/stop/restart controls, bounded logs and local preview links. Closing the app also accounts for owned project processes.
- Retain Chinese and English controls. Update compatible DOMPurify and marked patches, GitHub Actions, and grouped dependency maintenance without changing the runtime/toolchain major versions.
- Extend regression coverage across real Electron IPC, background tasks, checkpoint restoration, clipboard attachments and project process cleanup.

## 1.2.1

- Confirm before closing or reloading a window with unsaved file edits; cancelling exit keeps both the editor and any running task intact.
- Reconnect the agent before recovering from a renderer failure, settling interrupted turns and pending approvals so the restored conversation can continue.
- Add isolated Electron lifecycle and recovery checks, and clarify historical review documentation before GitHub publication.

## 1.2.0

- English and Simplified Chinese interface selection in Settings, applied immediately and remembered after restart.
- Localized app controls, management forms, usage panels, approval choices, native menus, dialogs, notifications and application errors.
- Language changes preserve message/code content, drafts, file edits and protocol identifiers; code selection and completed-task status remain correct across switches.
- Bilingual component checks and packaged Electron scenarios for language persistence, English approvals and switching back to Chinese.

## 1.1.0

- Background attention, optional notifications, executable file picker and installation guidance.
- Code copying and lazy syntax highlighting; structured tool changes and file navigation.
- CRLF-preserving atomic file saves, missing-Git state, external file actions, optional build directories and diff line numbers.
- Live workspace refresh, drag-and-drop attachments, restored window/panel preferences and sorted conversation history.
- Debounced draft serialization with immediate transition/close flush; ordered main-process chunk batching and lazy dialogs.
- Version-aware ACP initialization, longer history loading and fewer redundant snapshot copies.
- Rotating operational logs, safe-read renderer timeouts, explicit management confirmations and protected approval backdrops.
- Portable mock agent, real Electron E2E, reproducible Markdown benchmark, Windows CI, direct test dependencies and formatting checks.

## 1.0.4

Preserved drafts through project/session switches and restart, restored active sessions on reconnection, protected newer input during send/save, corrected Git subdirectory paths and IME handling, and retained Markdown reading position during streaming.

## 1.0.3

Localized approval options and added per-conversation permission controls in the composer and approval dialog.

## 1.0.2

Corrected omitted zero usage for valid active unified-billing periods while preserving unknown/error states.

## 1.0.1

Added account allowance and conversation context queries through official ACP extensions.

## 1.0.0

Initial Chinese Windows desktop: persistent ACP, project conversations, model controls, permissions, tool timeline, file/Git Inspector and Grok management.
