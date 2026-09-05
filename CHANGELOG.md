# Changes

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
