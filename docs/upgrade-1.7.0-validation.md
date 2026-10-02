# 1.7.0 implementation and validation

All sixteen candidates are implemented. Final local validation on 2026-10-03: **418/418 unit/component tests**, production build, complete source Electron E2E, complete packaged Electron E2E, NSIS installer and portable build all passed. Both E2E runs include the ten new cross-module checks. The release workflow also gates publication on packaged desktop-tool E2E. [Published release status](https://github.com/masonyang71324-oss/grok-desktop/releases/tag/v1.7.0).

| #   | Implementation                                | Evidence                                                                                                                                                                    |
| --- | --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1–2 | ConversationNavigation and shared row anchors | navigation unit/UI tests; source and packaged search/outline E2E                                                                                                            |
| 3   | source and ClipboardItem rich copy            | formatted-copy tests and real native clipboard E2E                                                                                                                          |
| 4   | FirstRunWizard and official stable installer  | native isolated installer cancellation/version checks; wizard/path/login E2E. A clean Windows account live installation was not performed on the user's configured machine. |
| 5   | DiffViewer/model                              | multi-hunk/word/prefix tests and Inspector E2E                                                                                                                              |
| 6   | workspace.search and ProjectFilePicker        | bounded search tests, multiple attachment E2E                                                                                                                               |
| 7   | Office worker/model/readonly components       | real DOCX/PPTX + sheets fixtures, readonly layout E2E, original file bytes retained                                                                                         |
| 8   | isolated WebContentsView + toolbar            | deferred capture/close/navigation tests, module-script webpage and original-draft screenshot E2E                                                                            |
| 9   | xterm + isolated ConPTY helper                | native process lifecycle tests; source/packaged interactive PowerShell E2E                                                                                                  |
| 10  | ProviderStore AST-range edits + form          | TOML conflict/preservation/secret projection/removal tests; real temp configuration form E2E                                                                                |
| 11  | retained token/DOM updates                    | reproducible conversation benchmark, selection and scrolling tests; detailed conversation report                                                                            |
| 12  | SessionHub fully-idle collector               | real mock ACP process count and identity/permission/metadata restoration tests                                                                                              |
| 13  | persistent ResizeHandle values                | keyboard/pointer component checks, small viewport and restart E2E                                                                                                           |
| 14  | local lazy KaTeX                              | formula/code/currency/incomplete expression and original-copy tests                                                                                                         |
| 15  | official metadata checker/workflow            | live proxy-aware query: CLI1.0.46, 24 methods, 166 type definitions; offline change/error cases                                                                             |
| 16  | Windows voice typing launcher                 | isolated launch contract and visible bilingual button; packaged script parsed without executing it or opening microphone                                                    |

## Measured scope

Local Chromium benchmark, representative100/500 completed messages plus streamed tail: update medians7.3/7.7ms before and3.5/4.1ms after. This measures the specified fixture, not a guarantee for every conversation. Actual ACP idle fixture reduced three processes to one and reloaded the original session. The interactive terminal runs in a separate helper because direct native usage left a worker thread on this host after shell exit.

## Review corrections

- Standard PPTX numeric IDs versus relationship IDs and inherited-position text; diff source lines beginning ++/--.
- Sleeping rename/reactivation, optional model context removal, preserved attachment/turn metadata on idle reload.
- Terminal snapshot/batch overlap and exited-output retention; browser duplicate/stale opening, capture lock and capture/navigation/close identity.
- Electron44 ClipboardItem API and external PowerShell script path in packaged resources.

No production credential/configuration files, paid model calls, live microphone or user project files were used as test fixtures. Native clipboard tests save and restore its previous content.
