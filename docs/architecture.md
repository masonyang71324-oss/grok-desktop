# Architecture

The Windows app uses Electron, React, TypeScript and Vite. It starts the installed Grok Build CLI as a persistent ACP stdio child with agent --no-leader stdio. The desktop does not store Grok credentials.

## Process boundaries

- electron/main.cjs owns the window, selected executable, native dialogs, settings, project services and the ACP client.
- electron/preload.cjs exposes a fixed command list and desktop events. Context isolation and renderer sandboxing are enabled; navigation and additional windows are restricted. Native clipboard writes and dropped-file paths use explicit preload/main APIs.
- electron/acp.cjs owns JSON-RPC request lifetimes, official model/mode discovery, permissions, session replay and the active foreground turn. Every outward snapshot is isolated from internal history. A session/load request may take 120 seconds; an unresolved state-changing request invalidates the transport because the active backend state is unknown.
- electron/background.cjs prevents incompatible management/restart operations while the client owns foreground or background work.
- src/App.tsx manages the selected project/session, timeline, composer and recovery. The fast App state harness is supplemented by real Electron E2E coverage.

## Rendering and persistence

The main process batches text chunks for up to 16 ms; permissions and terminal events first flush that batch. Preload restores the original event sequence. The renderer also coalesces timeline updates by animation frame and flushes before turn completion.

Markdown is fully parsed and sanitized so later references, fences and nested lists remain correct. Unchanged DOM blocks are retained. Code languages and management dialogs load on demand; syntax highlighting never touches the source used for copying. Tool diffs retain old/new content and file locations.

Drafts are keyed by normalized project path and session ID, with a separate draft before a project is selected. Edits update the in-memory draft immediately; storage serialization is debounced by 300 ms. Project/session transitions, sending and beforeunload flush immediately. Sessions with local drafts remain accessible even when the official history omits empty sessions.

Window bounds, maximized state, side panels and the Inspector tab are stored with user preferences. Restored bounds are constrained to a connected display. Normal shutdown waits for settings and log queues.

Unsaved or in-flight Inspector edits block `beforeunload`. Native confirmation defaults to keeping the editor open. Quitting first closes the window through its normal task and editor confirmations; the agent and queues are disposed only after the window has actually closed. Cancelling either confirmation therefore keeps ongoing work alive.

Renderer failure recovery explicitly interrupts the owned agent connection and settles pending approvals before reloading the page. The reloaded interface restores history through the normal initialization flow. This is an interruption-and-reconnect path, not live continuation of the failed renderer.

## Interface language

Settings store `language` as `zh-CN` or `en`, defaulting to Chinese for existing installations. The selector saves only that field immediately, preserving other unsaved settings. The renderer subscribes to one language store with React `useSyncExternalStore`; a local cache supplies the first-paint preference and main-process settings remain authoritative. `document.lang` and date/number formatting follow the selection. Language changes do not restart Grok or reload conversations.

Application copy uses Chinese source keys and English dictionaries in `src/locales/`; the main process has `electron/i18n.cjs` for native UI and its own messages. New interface strings must be added to the appropriate dictionary and rendered through the translator. Opaque model output, prompts, file contents, session titles, CLI identifiers and arguments are preserved. Generated labels are translated at render time where they outlive a language switch, and Markdown updates its controls without replacing code content or selection.

## Workspace and diagnostics

The Inspector accepts project-relative paths, detects external file changes before saving, preserves CRLF/LF and saves through a temporary file in the same directory. Atomic replacement retains file permission bits; custom Windows ACL preservation has not been separately implemented. Directory and Git refreshes never replace unsaved editor text.

A recursive, debounced watcher refreshes the visible project during tool work. Dependency/build noise is excluded. Users can separately show hidden build directories in the browser, refresh manually and open a file in its associated program or Explorer. Missing Git produces an explanatory empty state.

Background attention is opt-out and uses fixed notification text without task contents. Focus clears attention. Rotating logs contain operational event types, command names and status codes; content and upstream error bodies are not persisted.

## Development and verification

- npm test runs unit, state-machine and browser-component checks.
- npm run test:e2e runs the real Electron main/preload/renderer against scripts/mock-grok.cjs using isolated temporary data. GROK_DESKTOP_TEST_EXE selects a built executable for the same checks.
- npm run bench:markdown compares synchronous React rendering and layout on one page, using five warmups and fifteen measured updates at 10k/30k/60k characters. It reports medians, maxima, DOM counts and the browser version. It measures renderer cost, not model generation speed.
- CI runs on Windows for pushes and pull requests: install, format check, tests, production build and mock E2E. Hosted results are available in [GitHub Actions](https://github.com/masonyang71324-oss/grok-desktop/actions).

## Deferred architecture

The desktop still owns one active foreground session/turn. Upstream [ACP routing](https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-shell/src/agent/mvp_agent/acp_agent.rs) and [session execution](https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-shell/src/session/acp_session_impl/spawn.rs) provide a basis for multi-session execution. Implementing it here requires session-scoped event queues, permissions, background lifetime, cancellation and UI navigation; simply removing the exclusive lock is insufficient. The installed CLI has not been verified with simultaneous real prompts.
