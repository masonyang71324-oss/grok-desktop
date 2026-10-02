# Conversation upgrades implementation report

Implemented task A for items 1, 2, 3, 11 and 14. Root integration and complete release validation remain root-owned.

## Behavior

- Search enumerates each case-insensitive occurrence across currently loaded user/assistant/thought rows, tool title/input/visible structured output, attachment names, locations and the retained current `turnError`. Structured tool output replaces its duplicate flattened text in the index. Every result includes a readable snippet and a stable row/error target. Previous/next wraps, Enter/Shift+Enter navigates, composing Enter does not navigate, and session changes clear query and selection. This does not add or claim a historic error database.
- Question outline derives user rows from the same loaded timeline, using attachment names when user text is empty. It shares search row anchors.
- Every message/thought/tool root has `data-row-id`. User and assistant message actions distinguish exact original source from formatted content. Formatted copy clones visible Markdown content, removes code/UI controls and sends `{text, html}`; HTML retains headings, lists, tables and code. Plain text inserts block separators and tab-separated table cells. Original Markdown and code-only copy retain exact source.
- Math supports `$...$`, `\(...\)`, `$$...$$` (one line or block), and multiline `\[...\]`. Code spans/fences are handled by Marked and excluded. Bare numeric dollar amounts are currency. Unmatched delimiters and KaTeX-invalid formulas remain readable source. KaTeX renders lazily with `trust:false` and `throwOnError:true`; root must include local KaTeX CSS/fonts.
- Full-document lexing preserves appended Markdown reference definitions. The renderer caches the rendered HTML and retained nodes for each top-level block, sanitizes only changed HTML and retains existing DOM for unchanged blocks. Documents with top-level raw HTML remain sanitized as a whole so containers spanning Markdown blocks keep their nesting. It does not introduce virtualization or a second parse/history framework.

## Root integration contracts

1. Lazy-load default `ConversationNavigation` from `src/ConversationNavigation.tsx`. Props are `{sessionId:string, rows:TimelineRow[], turnError?:string, onNavigate:(target:ConversationTarget)=>void}`.
2. `ConversationTarget` is exported through `src/conversation-navigation.mjs` / `.d.mts`: `{kind:'row',rowId:string}` or `{kind:'error'}`. Root locates the matching `data-row-id`, opens target/ancestor `details`, calls `scrollIntoView({block:'center'})` and may briefly apply `conversation-jump`. Mark the retained error element `data-conversation-error`.
3. Merge `conversationUpgrades` from `src/locales/conversation-upgrades.ts` into the English locale map.
4. Main-process `clipboard.write` must accept `{text:string,html?:string}`. HTML payloads use Electron `clipboard.write({text,html})`; text-only payloads keep current semantics.
5. Add `@import 'katex/dist/katex.min.css';` to root global CSS (or import it in the root entry) so Vite emits the locally bundled font assets. `ConversationNavigation` imports `conversation-upgrades.css`, which supplies navigation, math overflow and jump styling.

## Verification

Observed missing-feature failures before implementation for navigation module, formula rendering and formatted-copy controls; a raw-HTML nesting regression was also reproduced before its repair. The final conversation-focused command passed **24 tests**:

```powershell
node --test tests/conversation-navigation.test.cjs tests/conversation-navigation-ui.test.cjs tests/conversation-rendering.test.cjs tests/rendering.test.cjs tests/timeline.test.cjs
```

Includes Chinese/tool/error occurrence counts, attachment outline, search wrap/session reset/IME, source and formatted payloads, code/currency/invalid/incomplete formula boundaries, formula/table/raw-HTML DOM retention, completed code selection/scroll and appended reference/list/table correctness. The earlier run including `tests/i18n-components.test.cjs` passed 27 tests before concurrent workspace changes. Its latest expanded 28-test run passed 27 and failed `an already-open new-file diff updates generated labels without translating file content`: new Inspector diff rendering changed the old `.diff-line` expectations and labels. Root and workspace agent were notified; that test remains workspace-owned. Live-language message/code tests still passed in that run. `tsc --noEmit` passed at module handoff. Full suite/build/Electron integration are intentionally left to root to run once against all modules.

## Reproducible measured scope

`node scripts/bench-conversation.cjs`, Chromium 153.0.8010.12, production React, stable completed-row references/callbacks, 7,813-character streamed tail, forced layout, 5 warmups + 20 measured updates:

| Loaded rows | Before median / p95 | After median / p95 |
| ----------- | ------------------- | ------------------ |
| 100         | 7.3ms / 9.4ms       | 3.5ms / 4.0ms      |
| 500         | 7.7ms / 10.2ms      | 4.1ms / 6.2ms      |

Both measurements retained code horizontal scroll 120px, selection `example`, and container scrollTop 300px. This measures synchronous streamed-tail rendering/layout on this machine, not CLI/network throughput or all conversation shapes.

Existing `node scripts/bench-markdown.cjs` after the change measured 10k/30k/60k character update medians 3.4/9.3/22.3ms, versus full replacement 16.6/46.9/90.1ms in that run. The parent-recorded old retained-DOM 60k median was 38.6ms; this comparison is supplemental because those measurements were separate runs.
