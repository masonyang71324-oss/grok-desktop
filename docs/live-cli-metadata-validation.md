# Official CLI metadata and session configuration verification

Date: 2026-10-03. Official installed CLI:1.0.46 (`2765805b9442`). These explicit probes use the official CLI's own authentication handling; they do not read authentication files or print credentials. ACP clients pass `--no-auto-update`. No `session/prompt` is issued.

`scripts/verify-live-cli.cjs` confirmed authenticated state, current stable version1.0.46, protocol1, four advertised models (`grok-4.7`, `grok-4.7-build-fast`, `grok-4.6`, `grok-4.5`) and27 commands. Advertised prompt capabilities: image=false, audio=false, embeddedContext=true. The desktop's local-file image fallback therefore remains meaningful; this check does not claim native image/audio prompt support.

`scripts/verify-live-session.cjs` created one temporary empty-project session and exercised23 advertised model/effort/context selections, including256000 and500000 token windows. Renaming, listing, closing/restarting the owned CLI, loading the original session and deletion all passed. No mode options were advertised, so no unadvertised mode was invented or tested. The temporary session was removed and owned processes exited.

Five selections in the final run received their authoritative notification after the configuration RPC returned. Initial probes incorrectly asserted immediately on the returned snapshot and observed old256000/xhigh values. Waiting for the matching actual state showed the correct500000/high values. Wire evidence and the [official asynchronous notification implementation](https://github.com/xai-org/grok-build/blob/2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8/crates/codegen/xai-grok-shell/src/agent/handlers/model_switch.rs#L255) support retaining the existing protocol. No product protocol change was made based on an early assertion.

Ignored local evidence: `test-results/live-cli-metadata.json`, `test-results/live-cli-session.json`. These probes verify catalog/login status and real session-control operations, not paid inference, production model quality, interactive device-code login, microphone recognition or all account states.
