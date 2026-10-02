# Whole-branch integration review

Reviewed baseline `d78cf6e` through `6e22674` against the sixteen-upgrade specification, implementation plan, progress and module reports, and `docs/reliability.md`. Review was read-only apart from this report. Concurrent root/E2E work is not treated as missing implementation.

## Findings

1. **P2 — Preserve desktop conversation history when waking an intentionally sleeping connection.** `electron/session-hub.cjs:373-385` preserves only permission mode and then replaces the retained snapshot with CLI replay. `_startTurn` stores `_desktopAttachments` and `_desktopTurnId` locally (`electron/session-hub.cjs:580-587`), whereas `electron/acp.cjs:735` submits only the prepared standard prompt; those desktop-only fields cannot come back from ordinary CLI replay. After opening more than the idle connection cap and returning to an evicted conversation, attachment chips and their original context/turn metadata disappear even though the app retained the complete idle snapshot. This is a new consequence of automatic eviction, and contradicts the explicit snapshot/attachment preservation requirement. Preserve the retained updates for intentional idle reactivation while refreshing actual CLI session state, or reconcile that metadata without replacing it wholesale.

   A no-network injected-client probe exercised real `SessionHub.send`, turn completion, `collectIdle({maxIdleConnections:0})`, and `loadSession`. Before sleep, its user update contained `diagram.png` in `_desktopAttachments` and a `_desktopTurnId`; after standard user/assistant replay, both fields were absent. No real configuration, documents, authentication or paid prompts were used. Root has been notified.

2. **P2 — Give external PowerShell a real packaged voice-script path.** At reviewed HEAD, `electron/dictation.cjs:14-15` passes `path.join(__dirname, 'voice-typing.ps1')` to `powershell.exe -File`, but `package.json` packages `electron/**/*` with `asar:true` and no corresponding unpacked resource. In the installed app that resolves inside `resources/app.asar/electron`, which PowerShell cannot read as a filesystem directory. Thus the new microphone button works from source but fails in the installed deliverable. Package the script as a real resource and pass that path (or read it with Electron and use an encoded command).

   Root confirmed this and has already added a concurrent `extraResources`/`scriptPath` correction. Its packaged file/parser verification remains root-owned; this finding describes the reviewed HEAD, not a claim that the concurrent correction still fails.

## Other review results

All sixteen deliverables have actual implementation and integration routes. Inspected main/preload allowlists, App ownership capture and draft alias transfer, lazy viewers, installer and provider refresh paths, idle protected-state predicate/reactivation, original diff/context retention, read-only Office and CSV text-editor handoff, terminal helper/input/output/exit/hidden lifecycle, isolated preview navigation/permission denial/capture owner, rich-copy/math rendering, upstream comparison/workflow, and sizing/locale wiring. No additional supported-flow P1/P2 defect was established in these boundaries.

The new diff fold marker shares a React key with the first retained context row. A narrow isolated Chromium probe showed the warning but correct row content after expansion and folding-checkbox toggles; no demonstrated data/display regression was found, so it is not escalated into a blocking finding.

This is a code/integration review, not a replacement for release evidence. Root owns the full suite, source/packaged Electron E2E, native packaged terminal smoke, bilingual/small-window screenshots and publishing. Root independently discovered and is fixing the Electron 44 rich-clipboard argument shape through actual E2E; that concurrent finding is not duplicated here.

## Scoped resolution review

Both findings are resolved in the inspected fixes; no remaining issue was found in their changed paths. This follow-up was limited to these two findings.

- **Idle history preservation — resolved by `2a23fe4`.** `loadSession` copies the retained updates before reconnect events can change the sleeping state, then restores only those updates onto the freshly loaded snapshot. CLI models, commands and configuration still come from the reload; the existing permission restoration remains intact. Independently ran `node --test tests/idle-metadata.test.cjs`: **1/1 passed**. The test uses an actual isolated mock ACP process, verifies exact history/attachment/turn-ID preservation, confirms refreshed model availability, and successfully sends a second turn without losing the first turn.
- **Packaged voice helper — resolved in root's resource-path fix.** Inspected `package.json` mapping `electron/voice-typing.ps1` to the real `resources/voice-typing.ps1`, `main.cjs` passing that path when `app.isPackaged`, and `dictation.cjs` passing the supplied path to PowerShell. Source launches retain their existing default. The packaged E2E now asserts that the external script exists outside ASAR. Root supplied verification that the packaged 543-byte resource exists, PowerShell's parser reads it without executing voice typing, and the latest packaged upgrade E2E passes 10/10 including that resource assertion. Those packaged checks were not mechanically repeated in this scoped review.
