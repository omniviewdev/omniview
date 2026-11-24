# Shared kit EmptyState

`@omniviewdev/kit` provides the presentation for a surface with nothing to show: a decorative `Icon`, a title, a hint, and at most one `Button`. Name what is missing, explain what appears there and how it gets there, and offer an action only when it leads out of the state. The component does not add a live region, move focus, or own scrolling.

| Surface | Presentation and host behavior |
| --- | --- |
| Bottom panel without a tool or a session | The compact layout keeps the 16 px glyph, body-size hint, and 12 px stack gap. `PanelEmpty` owns the polite status, inset and scroll container. The host centres the stack and switches it to a wrapping row below 112 px of content height. Only a tool that can start a session offers a button. |
| Restored Logs and Terminal sessions without feeds | The same panel placement and status explain what was lost and how to get it again. Neither state draws a button or mounts a viewer over a missing feed. |
| Notification centre | The standard layout keeps the 40 px icon box, caption and 8 px gap. The centre keeps the inset at the top of its own scroll region. Empty history and cleared history have no body action. When a source filter leaves no results, **Clear filters** returns focus to **Filter**; the centre still owns announcements. |

Collection `EmptyBody` remains separate. It is the status line under a table heading, with collection-specific placement and a reset command in the toolbar, not in the empty body.

## Verification

From the repository root:

```sh
pnpm --filter @omniviewdev/kit run refresh
pnpm --filter @omniviewdev/kit run test src/components/EmptyState/EmptyState.test.tsx
pnpm exec vitest run ui-next/shell/panel/Panel.test.tsx ui-next/shell/panel/logs/LogsBody.test.tsx ui-next/shell/panel/terminal/TerminalBody.test.tsx ui-next/shell/notices/Centre.test.tsx ui-next/shell/notices/Centre.keyboard.test.tsx
SECTIONS=centre node ui-next/shell/probes/notices-probe.mjs
SECTIONS=words node ui-next/shell/probes/terminal-probe.mjs
```

The centre probe compares the same mock rectangles, styles and text using the kit part selectors. The terminal probe checks the words and single command, then uses the splitter to verify centring and fit at normal and minimum height. Both probes exercise the empty state in WebKit and Chromium at 1440 × 900 and 1280 × 800.

Open `/?screen=parts&part=EmptyState` in `OMNIVIEW_UI=next pnpm run dev` to see a standard state without an action and a compact state whose button reports each launch request.

To verify session creation and keyboard handoff through the real Go host:

```sh
GOWORK=off OMNIVIEW_UI=next task build:server
SEAM_TERMINAL_REPEAT=1 node ui-next/plugins/e2e/seam.check.mjs
```

The seam scenario checks that one press of **New terminal** starts exactly one session and sends focus to its emulator. This runs in browsers against the Go server, not in the native WKWebView.

[WebKit gallery screenshot](kit-empty-state-evidence/gallery-webkit.png) · [WebKit and Chromium observations](kit-empty-state-evidence/browser.json). The two settled example subtrees had no DOM mutations during 60 animation frames at either supported viewport. This does not measure native rendering cost. Local checks passed for the kit, panel and notices suites, centre parity and terminal empty-state geometry.
