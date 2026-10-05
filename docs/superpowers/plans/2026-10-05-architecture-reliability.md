# Architecture Reliability Implementation Plan

> **For agentic workers:** Use the existing coordinated subagent workflow. The user authorized implementation; root owns integration and final release.

**Goal:** Implement the approved architecture improvements while preserving recovery data and simple operation.

**Architecture:** Keep ACP and Electron boundaries. Add content-addressed checkpoint persistence, verified process-lifetime ownership, conservative approval policy, runtime-derived UI recovery, an explicit diagnostic preview/export service, and channel-aware updates. Existing public UI/restore behavior remains compatible.

**Tech Stack:** Electron 44, Node 22+, React 19, TypeScript, CommonJS services, node-pty, electron-updater, existing JSZip.

**Spec:** [Architecture and reliability](../../architecture-reliability.md)

## Global Constraints

- Default stable channel, ask permission policy, and no automatic prompt/queue replay.
- Preserve legacy checkpoints and user files; hashes serve actual deduplication, not speculative auditing.
- Diagnostics omit content, full paths and credentials by construction; no remote upload.
- Only owned isolated processes may be used for crash probes; no stale-PID boot cleanup.
- Keep all new UI labels bilingual and use existing interaction patterns.

## Tasks

- [ ] Checkpoint worker: implement blob/manifests and compatible hydration/accounting/cleanup in `electron/checkpoints.cjs` plus a small storage helper; add focused migration, restore, write-failure, dedup and deletion regressions. Root handles any storage UI wording.
- [ ] Process worker: inspect/probe current terminal/runner ownership, implement only demonstrated crash-lifecycle repairs, and add an isolated main-kill regression with reliable owned cleanup.
- [ ] Permission worker: verify official read-tool metadata and implement `read` policy in `electron/acp.cjs`, the permission menu and dedicated helpers/tests. Root registers shared types/settings/locale.
- [ ] Root runtime: add one bounded reconnect path and move UI activity/action derivation into a focused module/hook backed by main snapshots; verify cancellation, interrupted queues, stale end events and draft preservation.
- [ ] Root diagnostics: add preview/export handlers and dialog, whitelist operational data, and verify exact exported preview plus synthetic secret exclusion.
- [ ] Root updates: add stable/beta selection, semver eligibility, in-flight channel protection, release metadata validation and a manifest-only rollout workflow; verify defaults, beta opt-in and no downgrades.
- [ ] Integrate, independently review the changed boundaries, run required source/packaged checks, publish and install the public release, retain evidence and remove the owned worktree.

## Review Focus

1. Legacy and new checkpoint references remain valid through deletion, corruption and failed writes; unchanged dates/sizes do not hide content changes.
2. A killed test desktop must not leave its internally owned descendants; external user terminals and unrelated live processes remain untouched.
3. Diagnostics preserve only approved fields even when filenames, log fields and messages contain synthetic secrets.
4. Read approval never infers safety from prose/shell command names; reconnect never repeats an interrupted prompt or unpauses a queue.
5. Beta/stable switching cannot install cached content from the wrong channel or downgrade; rollout changes retain original asset integrity metadata.
