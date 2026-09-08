# Grok Desktop 1.3.0 functional upgrade

User approved all six functional upgrades with stability and ease of use as mandatory constraints, and subsequently included appropriate maintenance/patch updates. Continue implementation without another scope approval.

## Global constraints

- Windows Electron desktop; retain existing Chinese and English interfaces.
- Preserve existing approvals, drafts, history, file newline handling, unsaved-editor protection and settings.
- No live model prompts in tests; use isolated mock ACP processes and temporary workspaces.
- No automatic replay of interrupted prompts or destructive file restoration.
- No upgrade of TypeScript, Node types or Vite major versions solely for novelty.
- Develop in the isolated 1.3.0 worktree; ship new versioned artifacts, retain 1.2.1 artifacts.

## User experience

1. Task center shows each owned session and its running/waiting/error state. Switching conversations does not stop work. Each active session has its own CLI connection. Pending approvals route to their originating connection. Messages can be explicitly queued, removed and resumed. Different projects may run concurrently; sessions sharing a directory serialize writes. Failed/cancelled queues pause. Restarted queues never execute silently.
2. Every turn captures a bounded workspace baseline and final state; users inspect changed files and choose restore with confirmation. Only restore files still matching the recorded after-state; later user edits cause a conflict instead of overwrite. Preserve pre-existing modifications. Restoring creates a recoverable record. Unsupported/oversize files are explicitly listed as omitted. File restoration does not pretend to rewind model conversation.
3. Add whole files or selected editor text/diffs to a visible context tray, inspect/remove before sending, and preserve these attachments in drafts and queued messages.
4. Detect project npm scripts and expose Run/Stop/Restart/Preview with bounded logs. Run only user-selected existing scripts. Stop only processes owned by this desktop. Preview URLs are loopback HTTP(S), opened separately without exposing the Electron preload to project content.
5. Support image-file attachments and pasted screenshots using actual ACP image capability negotiation. Reject unsupported inputs before a prompt is sent; retain the user's draft. No image editing/generation is involved.
6. Recovery explains error categories and retains queued inputs. Renderer reload restores live task state/approvals where the main process survives; a dead CLI restores saved history with explicit interrupted status and user-triggered resubmission.

## Shared IPC contracts

Existing session and workspace commands remain compatible. `SessionSnapshot.runtime` may contain `{turnId, connection, queued, error, permissions}`. `tasks.list` returns `TaskSummary[]`; `tasks-changed` carries `{tasks}`. Each TaskSummary has sessionId, cwd, title, status, turnId?, error?, connection?, queued (id/text/createdAt) and permissions. `session.enqueue` accepts an ordinary send payload and returns `{queueId}`. `tasks.remove` accepts `{sessionId,queueId}`; `tasks.resume` accepts `{sessionId}`. Session-scoped connection events include sessionId. Queue cancellation and errors never discard drafts.

Workspace service IPC: `checkpoints.list({cwd,sessionId?})`, `checkpoints.detail({id})`, `checkpoints.restore({id,paths})`; entries include id, cwd, sessionId, turnId, createdAt, status and file list. Runner IPC: `runner.inspect({cwd})` returns `{scripts:[{name,command}], state}`; `runner.start({cwd,script})`, `runner.stop({cwd})`, `runner.state({cwd})`; `runner-changed` carries `{cwd,state}`. State has status, script, log, url?, error?.

Attachment keeps `{name,path}` compatibility and adds optional `kind:'text'|'image'`, `text`, `mimeType`. Inline text must have a stable label; persisted pasted images use local files. `clipboard.image` returns Attachment|null. Workspace context can send `{name,path:'',kind:'text',text}`. No change to existing string prompt semantics.

## Verification

Baseline tests first. Targeted regressions cover simultaneous sessions and request-ID collisions, FIFO and paused queues, reload/approval recovery, external edit conflicts during restore, pre-existing dirty files, owned runner process cleanup, path spaces, image capability refusal and successful image payload, context selection/drafts and both languages. Final checks: formatting, unit/component tests, production build, original Electron E2E plus new workflow E2E, packaged workflow smoke. Audit dependencies after patch maintenance.
