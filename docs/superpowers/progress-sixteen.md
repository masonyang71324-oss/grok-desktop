# Progress: sixteen upgrades

Plan: `docs/superpowers/plans/2026-10-03-sixteen-upgrades.md`; isolated worktree `E:/ZCode工作区域/grok-desktop-upgrades`, branch `codex/sixteen-upgrades`, baseline `d78cf6e`.

- Conversation implementation: commits `3930690`, `a1de9da`; focused 24 tests passed, benchmark report saved. Root integration done; broader verification pending.
- Workspace implementation/review fixes: `b7ccd9f`, `47cf708`; 53 initial and 23 corrective focused tests passed. Independent review of three fixes complete (PPTX relationship id, missing transform text, hunk ++/--).
- Runtime implementation/review fixes: `315a1f3`; 48 focused tests passed. Scoped independent review clean for sleeping rename/reactivation and optional context limit removal.
- Root terminal/browser/dictation: modules and IPC/UI integrated, native isolated PTY smoke passed. Independent review's five issues fixed with regressions; scoped re-review found no remaining issues.
- Build passed. Initial full suite 397/415 passed; 18 failures all from two fixture asset/CSP integration issues. Moved KaTeX CSS into real app entry, corrected fixture multiline metadata removal; affected 19 tests now pass. Full rerun still required.
- Official upstream live check passed using Node 22.22 proxy/system-CA flags, version 1.0.46; `test-results/upstream-live.json`. npm command and workflow now carry those flags. Earlier raw-fetch failure is preserved in runtime report as an earlier observation.
- Agent `e2e_upgrades` writing new source/packaged end-to-end workflow and screenshots, owns only its test/report. Root will add script to package workflow and run existing E2E.

Final local verification: 418/418 tests, format/build, the entire source E2E suite and the entire packaged E2E suite passed. NSIS/portable1.7.0 built. New E2E ten-check group passed in both; latest packaged fixture `Ls4eFN`. Chinese/English/small-window screenshots inspected. Whole-branch review and scoped re-review resolved both final P2 findings. Production code is ready for release; cloud publication/local installation are recorded by release and installation output, not assumed from this local ledger.

Integration fixes after initial run: use Electron44 ClipboardItem[], put external dictation script in real packaged resources, preserve Office preview error alerts, explicitly select text tab in extraction E2E, release mock transaction locks before publishing replies, and remove redundant provider refresh restart. Node-API terminal prebuild is packaged without requiring Visual Studio; real packaged ConPTY was exercised.

Implementation choices: preserve unified navigation with separate remembered widths for sessions/tasks versus files. Read-only Office layout states complex/legacy limits. Voice button launches Windows voice typing, no microphone collection or auto-send. Terminal native code runs in a forked helper because direct ConPTY use left worker threads after normal shell exit on this host.
