# Sixteen-upgrade integration E2E

`tests/e2e-upgrades.cjs` exercises renderer → preload → main integration using `scripts/mock-grok.cjs`. It supports source Electron and `GROK_DESKTOP_TEST_EXE` for packaged builds. Run after the production renderer build:

```powershell
node tests/e2e-upgrades.cjs
$env:GROK_DESKTOP_TEST_EXE = 'C:\path\to\win-unpacked\Grok Desktop.exe'
node tests/e2e-upgrades.cjs
```

Every launch uses its own temporary `GROK_DESKTOP_DATA_DIR` and `GROK_HOME`. Provider TOML, git project, generated spreadsheets/positioned slides, copied public DOCX fixture and mock session state are disposable. No user configuration or authentication is read or changed. No real prompts, paid model requests, installer downloads or Windows microphone activation occur. Clipboard contents are backed up with Electron `ClipboardItem` and restored before shutdown, including assertion failures.

## Bounded integration coverage

| Upgrade                                | Integration check                                                                                                                                                                           |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Conversation search / question outline | A `MOCK_RENDER` response is searchable; next-hit opens the collapsed tool row; question outline jumps to its user row.                                                                      |
| Formatted / original copy              | Native Electron clipboard contains code HTML and matching plain text without copy controls; original Markdown stays exact.                                                                  |
| First-run wizard                       | Detect existing mock CLI, choose its path, recheck sign-in, choose project and complete without installation.                                                                               |
| Diff                                   | Disposable git change opens Inspector diff; split view and word marks render.                                                                                                               |
| Project file search                    | Two checkbox selections attach to composer; generated dependency directory is excluded.                                                                                                     |
| Office preview                         | Read-only sheet tabs/cell coordinates, static PPTX and DOCX iframe render; original fixture bytes remain unchanged.                                                                         |
| Web preview                            | Local HTTP page renders an external module script in isolated child web contents; screenshot captured after changing session returns to originating session draft and never sends a prompt. |
| Interactive terminal                   | Actual xterm keyboard input reaches native PowerShell/ConPTY; hidden panel retains running session; stop/reopen retains output; explicit restart creates a new terminal.                    |
| Provider form                          | UI edit and disable/enable preserve TOML comments and unknown root/model keys.                                                                                                              |
| Resizing                               | Sidebar keyboard and pointer resize and composer keyboard resize persist across restart; small window keeps composer inside viewport.                                                       |
| Voice / bilingual UI                   | Chinese and English visible actions include voice typing, terminal, preview, file reference and navigation; no Win+H is invoked.                                                            |

Math rendering, streaming benchmark, idle eviction, installer cancellation and upstream metadata are covered by their focused module tests and existing suites. This suite does not claim separate integrated acceptance for those behaviors.

Screenshots are written to `test-results/upgrades/source/` or `test-results/upgrades/packaged/`: conversation, provider, DOCX/sheet/slides, terminal, screenshot draft, English desktop and Chinese/English small windows. Failed runs also retain `failure.png` and print the temporary fixture directory.

## Execution evidence

Source execution: **10/10 checks passed, exit 0** on 2026-10-03 after production renderer build. Fixture artifacts: `D:\Personal\Temp\grok upgrades Xxkxq0`; screenshots: `test-results/upgrades/source/`. Native formatted-copy initially revealed the main handler using Electron's removed object-shaped clipboard API. Main now writes `ClipboardItem[]`; the rerun verified HTML and original Markdown through the native clipboard.

Packaged execution: **10/10 checks passed, exit 0** on 2026-10-03 against `release/win-unpacked/Grok Desktop.exe`, after the integration owner confirmed the latest package was complete. Fixture artifacts: `D:\Personal\Temp\grok upgrades ISAk5f`; screenshots: `test-results/upgrades/packaged/`. This includes the actual packaged native ConPTY helper and isolated browser view, plus the non-activating assertion that `resources/voice-typing.ps1` exists outside ASAR.

One earlier rapid provider-mutation run left the mock fixture's shared-state lock after a redundant connection restart. Integration removed the repeated catalog restart from the provider change callback; subsequent source and packaged UI edit/disable/enable checks passed. All completed runs reported no renderer `pageerror` events. Chinese/English small-window screenshots were visually inspected: composer, actions and footer remain inside the viewport.
