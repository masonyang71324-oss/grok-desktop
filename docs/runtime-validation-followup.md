# Runtime validation follow-up

Date: 2026-10-03. Baseline: `991d863fa908ff906b5cdaad060dbbfee3720213` / Grok Desktop 1.7.1. Host: Windows 10 Pro `10.0.19045`, Node `22.22.2`, node-pty `1.1.0`. These checks cover the remaining installer and native-terminal questions; they do not replace the existing full-suite and packaged-app results.

## Official installer boundary

Read the current [official PowerShell installer](https://x.ai/cli/install.ps1) before execution. Its direct persistent effects include:

- `%USERPROFILE%\.grok\downloads`, default `bin`, PowerShell completions, and `config.toml`; `GROK_BIN_DIR` changes only the executable destination. Existing executables may leave `.old` files; payload replacement uses temporary backups.
- `grok.exe` and `agent.exe`, optional grove executables, and `%LOCALAPPDATA%\grok\git\<version>` with staging/cleanup.
- User PATH through `Environment.SetEnvironmentVariable(..., 'User')` when the bin directory is absent.
- With a deployment key, creation, replacement, or deletion of `managed_config.toml` and `requirements.toml`. Existing `auth.json` is read; the script does not directly write it.

The script also runs the downloaded executable to generate completions. Its runtime initialization is another reason that redirecting only `GROK_HOME` is insufficient to call this a fully isolated installer run.

Read-only host checks found Windows Sandbox disabled and `WindowsSandbox.exe` absent. Hyper-V is enabled and `vmms` is running, but the local `root/virtualization/v2` inventory contains only the host, with no virtual-machine guest; `Get-VM` also fails to resolve this host or localhost. No Windows features, VM images, user PATH, existing CLI configuration, or credentials were changed. The official installer was **not executed**. Clean-Windows installation, installer download cancellation, PATH integration, and optional bundled payload installation remain unverified on a disposable guest.

## Actual stable payload and empty-home login status

The later disposable-Windows workflow below supersedes the local-host-only installation limitation. The official installer was still not run on the user's configured computer.

The official [stable pointer](https://x.ai/cli/stable) resolved to `1.0.46`. Downloaded the exact Windows x64 executable URL selected by the installer: [grok-1.0.46-windows-x86_64.exe](https://x.ai/cli/grok-1.0.46-windows-x86_64.exe), 159,032,648 bytes. The payload is an executable, so no archive extraction is involved.

Before running authentication-related inspection, checked the official [home-resolution implementation](https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-dirs/src/lib.rs) and [file-location documentation](https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-pager/docs/user-guide/14-headless-mode.md). Nonempty `GROK_HOME` overrides the CLI state directory; Windows user-home resolution follows `USERPROFILE`. The child received an explicit environment allowlist with temporary `GROK_HOME`, `USERPROFILE`, `HOME`, `APPDATA`, `LOCALAPPDATA`, `TEMP`, and `TMP`, an empty workspace, no inherited credentials, and auto-update disabled. These overrides were child-process values only.

Actual results through the application's `readCliStatus` parser:

| Check                  | Result                                   |
| ---------------------- | ---------------------------------------- |
| `grok.exe --version`   | Exit 0; `grok 1.0.46 (2765805b9442)`     |
| `grok.exe models`      | Exit 0; `You are not authenticated.`     |
| Desktop classification | Version `1.0.46`, `authStatus: required` |
| Temporary auth file    | Absent before and after                  |

The CLI initialized config, bundled documentation, logs, and session-search storage in the temporary home. No login, browser authentication, model prompt, paid request, updater install, or official installer was run. This is **partial installation-path verification**, not proof of a fresh Windows installation. Local evidence is in ignored `test-results/cli-install-probe/results.json` and its probe script.

## Official installer on disposable Windows — passed

[Workflow37052073628](https://github.com/masonyang71324-oss/grok-desktop/actions/runs/37052073628) ran the production `CliInstaller` with the unmodified official installer on a disposable Windows10.0.26100 runner and Node22.22.2. `scripts/verify-clean-cli-install.cjs` refuses to run outside explicitly marked Windows GitHub Actions. It creates two empty child profiles and intentionally allows the official installer to update that disposable runner's User PATH.

The first installation was cancelled while the actual main executable download contained4096 bytes (displayed0%, not a pre-download simulation). It reported cancelled, installed no executable, added no target PATH entry, and all owned processes exited. The second independent empty profile reached installing→verifying→installed with actual version1.0.46. PATH registration, config, completions, agent/grove executables and bundled Git were present; the real CLI reported login required, and no auth file was created. Cleanup confirmed all owned processes exited. Safe artifact: `test-results/cloud-clean-install/clean-cli-install.json` (also downloadable from the workflow).

This covers actual first installation and download cancellation on the stated runner. It does not claim an interactive OAuth login, a same-directory cancellation/retry cycle, all Windows consumer editions, or successful installation behind every proxy. No user-computer PATH, account or CLI configuration was changed by this CI run.

## Isolated timeout fixture

Existing `tests/runtime-upgrades.test.cjs` covers isolated installation/version fixtures, cancellation with native descendant cleanup, repeated cancellation, failed verification, and late zero exits after a timeout. No claim here treats those fixtures as an official installation.

An additional bounded native timeout probe ran the real `CliInstaller` and `killOwnedTree` against the existing `mock-cli-installer.cjs tree` fixture. The descendant was ready at 82 ms and confirmed alive immediately before timeout cleanup; the 1,000 ms timeout fired at 1,016 ms. At 1,168 ms the installer reported `error` with its timeout message, and both the exact installer PID and descendant PID were absent. Evidence: ignored `test-results/cli-install-probe/timeout-result.json`. Cleanup was limited to those owned processes.

## Native-terminal CI failure

[Release attempt 1](https://github.com/masonyang71324-oss/grok-desktop/actions/runs/37046585154/attempts/1) failed only `native terminal exits its isolated host and supports restart without lingering handles`: at 10,128 ms the expected `exited` state was still `running`. That log contains no terminal output or helper-stage timings, so it cannot identify a slow shell startup, unexecuted input, or delayed helper exit. [Attempt 2](https://github.com/masonyang71324-oss/grok-desktop/actions/runs/37046585154/attempts/2) passed the same test in 5,459 ms on `windows-2025-vs2026` image `20260925.250.1`. The two separate Windows desktop checks on the same baseline also passed. The cloud failure's root cause remains unresolved.

The original single native test passed locally in 2,024 ms. A bounded four-terminal diagnostic run then compared three immediate-input starts with one prompt-ready start, using Chinese/space-containing project paths. All four executed a computed output marker, reported the exact cwd, returned Chinese output, naturally exited with code 0, and exited their separate helpers:

| Probe              | First output | Command output | Helper exit |
| ------------------ | ------------ | -------------- | ----------- |
| Immediate input 1  | 311 ms       | 824 ms         | 1,852 ms    |
| Immediate input 2  | 364 ms       | 810 ms         | 1,858 ms    |
| Immediate input 3  | 362 ms       | 810 ms         | 1,867 ms    |
| Prompt-ready input | 336 ms       | 776 ms         | 1,845 ms    |

First-output/helper times are measured from helper creation; command times are measured from opening the terminal. Afterwards all eight recorded helper/shell PIDs were absent. No existing user terminal or application was stopped. Evidence: ignored `test-results/runtime-native-probe/diagnostics.json`. The first diagnostic harness run misinterpreted ConPTY cursor positioning as a missing newline before the output marker; after correcting that harness-only matcher, all four passed. This was not a product failure.

The native regression keeps its existing 10-second operation deadline and 15-second overall limit. It reports Node/Windows versions, first output, prompt readiness, executed command output, final state, exit code, elapsed time, and a bounded fixture-output tail on a failed exit. Its marker is computed by PowerShell so the echoed command alone cannot satisfy the output assertion. No retry, timeout increase, or product-side diagnostic hook was added.

A later [cloud diagnostic](https://github.com/masonyang71324-oss/grok-desktop/actions/runs/37057671678) captured first output at228ms but only terminal initialization sequences, with no PowerShell prompt or executed marker before the deadline. This narrows the failing phase to shell startup rather than proving a helper-exit leak. The lifecycle probe now waits for the actual PowerShell prompt before sending its command, matching the existing real-xterm E2E sequence, within the same total deadline. The revised local run observed prompt443ms, command630ms and helper exit1682ms. This is not a claim that every cause of slow Windows startup is resolved.

## Confirmed Unicode truncation fix

Retained terminal output was capped with `slice(-200000)`, which could start inside a surrogate pair. A real manager probe with an emoji followed by 199,999 ASCII characters retained a lone `DE00` code unit; `isWellFormed()` was false and UTF-8 conversion produced a replacement character. This affects a reopened terminal snapshot when long output crosses that character boundary.

Added a regression that first retains a complete emoji at the boundary, then appends a Chinese character and verifies a well-formed trimmed snapshot, reopen consistency, and unchanged streamed output. It failed before the fix at the well-formedness assertion. `electron/terminal.cjs` now moves a truncation boundary past a low surrogate; the existing output limit remains in force.

Validation after the fix: `node --test tests/terminal.test.cjs tests/terminal-native.test.cjs` passed **6/6**. Native stage diagnostics recorded first output at 230 ms, command output at 626 ms, and exited state at 1,663 ms. Scoped Prettier formatting was applied. The integration owner is responsible for final combined checks; this subtask did not rerun unrelated suites or create a commit.
