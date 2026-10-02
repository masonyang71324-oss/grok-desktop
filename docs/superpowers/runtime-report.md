# Runtime upgrades: integration and verification

Runtime implements upgrades 4, 10, 12 and 15 in the approved sixteen-upgrade design. The root worker owns App/main/preload/type/settings/i18n integration and release validation.

## Official sources

- Installer: <https://x.ai/cli/install.ps1>. Executes the official PowerShell script with `GROK_CHANNEL=stable` and an explicit `GROK_BIN_DIR`, hidden, without a shell. Inherited `GROK_VERSION` and `GROK_DEPLOYMENT_KEY` are removed so an official stable installation does not silently select a pinned/enterprise deployment. Production installation has the official script's own configuration and PATH behavior; development tests never execute it.
- Custom models: <https://docs.x.ai/build/settings/reference>. Editable `[model.<id>]` fields are `model`, `base_url`, `name`, `env_key`, `api_backend` and `context_window`. Backend values are `chat_completions`, `responses`, `messages`. Actual model enable/disable uses the documented `[models].disabled_models` list, which removes a model from the catalog. It does not invent an `enabled` field in model tables.
- Protocol schema: <https://agentclientprotocol.com/protocol/v1/schema>. Maintenance compares the official stable version and the public v1 wire-method inventory against the committed baseline. This does not establish field-semantic or xAI-extension compatibility. Review release changes before modifying app behavior.

## Service contracts

`electron/cli-installer.cjs` exports `CliInstaller` and `killOwnedTree`.

```js
new CliInstaller({ emit, binDir?, spawnFn?, killTree?, timeout? })
installer.state() // snapshot
await installer.start() // final snapshot; retries allowed
await installer.cancel() // stops owned process tree and waits for settlement
await installer.dispose() // close + cancel
```

States are `{status,log,path?,version?,error?}`. Status is `idle | installing | verifying | installed | cancelled | error`; events are `{type:'cli-install-state',state}`. Installation requires exit code zero and a successfully executed `grok.exe --version` returning a recognized Grok version. Cancellation/timeout apply during installation and verification. Repeated cancellation coalesces the same tree stop, and a late zero exit after timeout cannot proceed to verification. Progress is real installer stdout/stderr, capped at 32,000 characters, without invented percentages; it is not sent to telemetry.

Register `cli.install.state/start/cancel`. Start is a management mutation; cancellation must bypass that mutation lock. Only after `installed`, persist `grokPath` and refresh the engine outside the installation mutation lock.

`electron/providers.cjs` exports `ProviderStore`.

```js
new ProviderStore({configFile?,env?})
store.list() // {baseline,models}
store.save({baseline,id,fields})
store.remove({baseline,id})
store.setEnabled({baseline,id,enabled})
```

All mutations return a new list/baseline. Public model records contain `id`, supported public fields, `enabled`, `hasKey`. `env_key` is a variable name and `hasKey` is only a boolean. `api_key`, headers, unrelated keys, raw TOML and environment values are never returned. Main holds the text baseline behind a random revision token; it compares exact text before writing. Parser diagnostics are replaced by application messages, avoiding source excerpts containing secrets. AST range edits retain unrelated tables, unknown keys, inline secrets, newline style and comments, including comments inside `disabled_models` arrays. Ambiguous inline/dotted table layouts and descendant-table removal are explicitly rejected. Writes replace via a temporary file; failures preserve the original file and the form.

For writes, `fields.context_window:null` explicitly removes the optional key while retaining its inline comment. Null is an application command marker, never a TOML value or public list value. Clearing that form input restores the CLI default instead of silently retaining the previous setting.

Register `providers.list/save/remove/enable`, mapping enable to `setEnabled`. Mutations require the normal idle management guard and engine reconnection; reads must not reconnect or read actual secret values into renderer data.

`SessionHub` additionally exports `isIdleEntry`, accepts `maxIdleConnections` (default 3), and provides:

```js
hub.setActiveSession(sessionId) // protect the visible conversation
hub.collectIdle({protectSessionId?,maxIdleConnections?}) // evicted IDs
```

Root periodically calls the collector and clears that timer on shutdown. The cap applies to fully idle session transports; the catalog is separate. Oldest eligible connections sleep first. Running/preparing/finalizing, workflow controls, loading, queue, permission, background, pending-session/mutation and ACP request/connection/operation work are excluded. Snapshot/capabilities/task summary remain available. Intentional disposal suppresses error/disconnected events and instead emits `{type:'connection',sessionId,state:'sleeping'}` with normal idle task status. Add `sleeping` to connection types and use a normal resource label. Loads, sends, configure, usage, extension, rename, delete and permission-mode use reactivate the same session ID/cwd; saved permission mode is restored before further use. `setPermissionMode` now returns a promise.

## Components and locales

`FirstRunWizard` default export props:

```ts
{
 cliStatus?: {path?:string;version?:string;authStatus?:string;error?:string};
 installState?: CliInstallState;
 request: (command:string,payload?:any)=>Promise<any>;
 onComplete: (cwd:string)=>void;
 onClose: ()=>void;
}
```

It reads `cli.status`, `cli.install.state`; uses `cli.install.start/cancel`, `cli.login`, `dialog.grok`, `settings.save`, `dialog.project`. File/folder dialogs return a path string or null. Choosing CLI persists the chosen path with `settings.save` before actual version recheck. Initial detection completes before setup actions become available, preventing stale initial reads from replacing installation progress. Existing versioned CLI skips installation. Opening login is only an opening result; completion requires `authStatus==='authenticated'` from a recheck and a chosen project. Closing during installation cancels first. Root passes the live installation event state.

`ProviderSettings` default export props are `{request,onClose,onChanged?}`. It uses provider commands listed above. Failures retain drafts, removal requires explicit confirmation, model IDs are immutable while editing, and only public supported fields are submitted. Root refreshes its model/session catalog through `onChanged`. Exported types: `ProviderFields`, `ProviderModel`, `ProviderList`.

Root merges `runtimeUpgrades` from `src/locales/runtime-upgrades.ts` and `require('./runtime-i18n.cjs')` from `electron/runtime-i18n.cjs`. Both components import dedicated responsive CSS. Chinese/English labels are supplied for setup, model forms, state and application errors.

## Upstream maintenance

`node scripts/check-upstream.cjs --output upstream-report.json` reads only public HTTP metadata and the committed JSON baseline; exit 0 means unchanged, 2 means changed/review required, 1 means retrieval/parse failure. It never installs CLI, reads authentication, sends a prompt, modifies the baseline or rewrites application code. `--baseline <file>` and `--fixture <directory>` support review/isolated reproduction; fixtures contain `stable.txt` and `schema.html`. Failure reports explicitly carry `changed:null`. The weekly/manual read-only GitHub workflow preserves the report artifact even when comparison fails. The baseline version is current CLI 1.0.46/protocol v1.

The live Node request on this development host failed (`fetch failed`; the direct stable endpoint probe timed out). Browser research verified the official installer/settings/schema sources, but does not substitute for a successful live metadata run. This environmental network limitation is reported explicitly; offline comparison is tested and CI will execute the public check.

## Verification scope

The focused command is `node --test tests/runtime-upgrades.test.cjs tests/runtime-components.test.cjs tests/session-hub.test.cjs`. Tests were introduced failing before service/UI implementation and reproduce later corrections before fixing them. They use isolated temporary homes/configs and injected/actual fixture processes only. No real CLI installation, authentication/config write, user project mutation or paid prompt was performed.

The final focused run passed 48/48 with no skips. TypeScript checking found only currently unused integration imports/state in root's in-progress `App.tsx`: `ProjectFilePicker`, `OfficePreview`, `FirstRunWizard`, `ProviderSettings`, `TerminalPanel`, `WebPreview`, `canPreviewOffice`, `filePickerOwner`, `previewOwner`, `officeLayout`, `installState`. Runtime modules had no TypeScript diagnostics; this is not a claim that the integrated build passes yet.

Native Windows fixture cancellation stopped the installer descendant process. Actual mock ACP transports dropped from three connected sessions to one under the collector, then reloaded the identical original session with preserved permission mode; this measures connection count, not a blanket memory or performance claim. Component tests cover existing-install skip, actual selected-path persistence/recheck, initial read ownership and public-only provider submission. Existing session-hub queue/background/checkpoint regressions remain in the focused run. Full suite/build/packaged E2E/release remain owned by root integration.
