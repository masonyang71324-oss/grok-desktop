# Large attachments and Grok Build 1.0.52 implementation plan

**Goal:** Let supported large attachments reach Grok Build without the desktop's old 10/20 MiB gate, keep conversion responsive and truthful, and preserve background approvals across normal foreground completion.

**Architecture:** Native document/image inputs use local-file references with bounded header inspection. Existing document extractors receive file paths and run in cancellable workers; long extracted content becomes managed UTF-8 text, while previews return bounded excerpts. Source documents remain untouched and native upstream errors remain authoritative.

**Constraints:** Keep the existing attachment/send interaction, Chinese/English UI, explicit file access, draft retention and user approval modes. Do not promise unlimited upstream reads or native Word/Excel support without evidence. Existing parsers retain timeout and memory protections; generic buffer-based converters use a 128 MiB input budget and a 32 MiB extracted-text budget, stated as local conversion limits, not Grok limits. DOCX path readers skip unrelated embedded media. No actual user prompts are sent to a paid model for verification.

## Work

- [x] Replace native document size rejection/full read with bounded header reads; route oversized or unsupported inline images by path. Correct misleading PPTX offset/limit instructions.
- [x] Support path-based, cancellable Word/common-document workers and configurable extraction budgets, retaining existing parser fidelity and small-input APIs.
- [x] Reference large plain text directly when its encoding is safe; stream conversion when necessary. Offload large extracted text to managed files protected from cleanup during use; keep previews bounded and free of send-side storage effects.
- [x] Preserve unanswered approvals on normal parent completion, including approvals arriving later for a loaded session. Explicit stop, error, disconnect and disposal still clear them.
- [x] Verify installed Grok 1.0.52 capabilities and native document behavior using an isolated local synthetic provider; update the public upstream baseline and attachment documentation.
- [x] Run focused regressions, build/type/lint checks and mixed-attachment source/packaged Electron scenarios; prepare the local installer and add these checks to the hosted release gates.

## Verification focus

Large valid PDF/PPTX inputs and totals above the old limits must produce short path-based prompts without reading their entire binaries. Large image-heavy DOCX and >1 MiB extracted text must retain final sentinels. Cancellation stops conversion before prompt submission; corrupt inputs fail explicitly and the next conversion works. Managed text must remain available for the session and cannot be removed while preparing/running. The full preview must never be confused with an excerpt. Normal foreground completion must not silently reject a pending background approval.

## Upstream evidence

Official stable metadata and changelog identify 1.0.52. The installed CLI confirms 1.0.52, authenticated status, four available model IDs, 38 commands, and `image: false, embeddedContext: true`; metadata verification made zero prompt requests. The public source mirror predates 1.0.52, so its documented 50 MiB PDF/PPTX limits and PDF pagination are reference evidence, not a substitute for the binary probe.
