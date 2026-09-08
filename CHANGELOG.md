# Changes

## 1.4.0

- Native Grok PDF/PPTX/IPYNB attachment routes verified with Grok Build 1.0.13.
- Local spreadsheet, compatible WPS/Office template, legacy PowerPoint, OFD,
  OpenDocument, RTF, email and EPUB text extraction in bounded workers.
- Chinese GBK/GB18030 and BOM UTF-16 decoding, original-file open buttons and
  native-reading preview explanations in Chinese and English.
- Explicit limits and unsupported proprietary-file guidance preserve failed
  drafts; CAJ still needs CAJViewer → Print to PDF.
- See [format matrix](docs/attachment-formats.md) for the support boundary.

## 1.3.2

- Read common Word DOC/DOCX attachments by extracting text locally before sending. No Word, WPS or additional application is required; original files are not modified.
- Preview extracted body text, text boxes, headers, footers, notes and comments, with a clear notice that images, seals and original layout are not included.
- Run extraction in a worker with a 30-second timeout. Reject unreadable, empty or oversized results without sending partial text; keep drafts on submission failure.
- Add Chinese/English document preview and error states, document fixtures and real Electron coverage for both Word formats.

## 1.3.1

- Enable screenshot sending on Grok Build 1.0.13 through its local read_file image tool when native ACP image input is unavailable. Native image support remains in use when advertised.
- Show clickable screenshot thumbnails and explain how images will be sent, in Chinese and English. Pasted images are saved automatically; missing or invalid files keep the draft intact.
- Add real Electron coverage for screenshot paste, preview, both sending routes, draft reload and missing-file failures. Materialize clipboard backups before replacing them in E2E tests.

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
