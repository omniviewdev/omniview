# T7: URLs and OSC 8 hyperlinks through the host's opener (#696 step 1)

**Status: for review.** Worktree `~/omniview/wt/t696-urls`, branch `feat/terminal-links-urls` on `origin/main` 11b8d3758. Page only: no Go, no new bound call.

## 1. What was there, what this step adds

T3a (#703) already made printed `http` and `https` addresses and OSC 8 hyperlinks links: `@xterm/addon-web-links` with its own handler, the emulator's own `linkHandler` (no `confirm()`, no `window.open`), the modifier click (Command on a Mac, Control elsewhere) through `TerminalSessions.openExternal` to `Browser.OpenURL`, and a tooltip that said `Follow link (cmd + click)`. What it did not do, and this step does:

| Gap named by the issue | Now |
|---|---|
| "show the target before it opens" | the tooltip has a second line, the TARGET (`LinkTip`: words, then target, in the one polite live region); a hyperlink whose text says `https://a.example` and whose target is `https://b.example/login` shows `https://b.example/login` |
| "decide `file:`" | refused (decision 1) |
| "decide `http://localhost` to the host's own port" | refused on the page's own port and scheme, allowed elsewhere (decision 2) |
| "a link is reachable by keyboard" | `Open link` in the terminal's context menu (decision 3) |

## 2. Decisions, with reasons

1. **`file:` is refused, and so is every scheme but `http` and `https`** (`javascript:`, `data:`, `vscode:`, `ftp:`, `mailto:`). `Browser.OpenURL` hands the address to the system, which opens a `file:` URL with whatever is registered for that file, on the machine that runs the host (in server mode, not the person's machine): a program that prints a link can start another program. File links are step 2 to 5 of #696 (the matcher, `ResolveLink` that says whether the file exists, `openFile`), which open a path the host has stat-ed, and never a URL a program wrote. Refused at three layers, each tested: the emulator (`allowNonHttpProtocols: false`: it never hands over the link), the hook (`canFollow`: no tooltip) and the registry (`openExternal`: no call, one warning).
2. **A link to the host's own server is refused, a dev server is not.** In server mode the app is a page that the host serves, and its API is on the same port: `http://localhost:<that port>/...` printed by a program is an open redirect to the host's loopback API (the system browser sends a request the person never meant). `isOwnServer(uri, location)` refuses an address whose scheme and port are the page's and whose host is the page's own name or any name of this computer (`localhost`, `*.localhost`, `127.0.0.0/8`, `0.0.0.0`, `::`, `::1`, `::ffff:127.x`; the address parser has turned `127.1`, `2130706433` and `0x7f.0.0.1` into a dotted quad first). `http://localhost:3000/` (a dev server, the commonest link there is) stays followable. Not verified: the native window, whose page is `wails://`: it has no port to point at, so the rule does nothing there [INFERENCE: the native build has no other loopback listener the page can name; not looked at].
3. **The keyboard path is the context menu's `Open link` submenu** (VS Code's "Open Detected Link" is a quick pick of the links in view). The terminal's menu already opens from the keyboard (Shift+F10, the Menu key), so no new chord, no new control to Tab to (AGENTS 19 is met by the menu, which is the terminal's one keyboard door to its actions); the arrow opens the submenu; each item is named by the TARGET, in reading order, each once, at most 50; Enter opens the one chosen through the registry and the keyboard goes back to the terminal. A link the registry will not follow is not listed. With no link in view the item is unavailable and says `No links in view`. Smallest way: no new surface, one item and a pure engine read.
4. **The links in view come from the emulator** (`Engine.viewLinks()`, `xtermEngine.ts`): the printed addresses in the rows on screen (a wrapped line read as one, at most ten rows, a line cut at 2,048 characters, an address over 2,083 dropped) and the targets of the hyperlinks written there, found by an observer of OSC 8 (`parser.registerOscHandler(8)`, which returns `false` and so leaves the emulator's own handler alone) with a marker at the start and the end of each, at most 128 kept. The text of a hyperlink that is itself an address is not listed as a second link (its cells are the hyperlink's). Only the active buffer's links are in view (the alternate screen has its own).
5. **The tooltip keeps the whole target** in the document and in what a screen reader says (the person decides on the target); the picture clamps to eight lines of at most 32 rem (`overflow-wrap: anywhere`).
6. **One rule, two callers.** `isWebAddress` (scheme, slashes, a host, no space or control character or backslash) lives in `links/links.ts`; the registry's own copy (`isOpenable`) is deleted. `TerminalSessions.canFollow(uri)` (can open, web address, not the host's own server) is what the hook asks for the tooltip and the click, and what the menu asks for its items.

## 3. Tests, red then green

| | sha | what |
|---|---|---|
| red | `1435dbc81` | 44 tests fail by their own assertions (tooltip has no target, `isOwnServer` says no for the page's own port, `viewLinks` is `[]`, no `Open link` item, `canFollow`'s refusal); the stubs make the failures assertions, not missing names |
| green | `1520783c9` | the code: `links.ts`, `scan.ts`, `useTerminalLinks.tsx`, `LinkTip.module.css`, `TerminalSessions.ts`, `xtermEngine.ts`, `menu/*`, `TerminalBody.tsx` |
| probe | `efe99f436` | `terminal-urls.mjs`, `terminal-urls-probe.mjs`, `terminal-urls-controls.sh`, the host's `hyperlinks` command, the two units, the seam's and the menu probe's new `Open link` item, the registry's `window.open` test |

**Emulator of each page test.** `xtermEngine.test.ts` (`the links of a real emulator`, `and the links in view`): REAL xterm 6.0.0 in jsdom, the link provider and the OSC 8 sequence parsed by the real parser. `links.test.ts`: no emulator (pure). `useTerminalLinks.test.tsx`, `terminalMenu.test.ts`, `useTerminalMenu.test.tsx`: no emulator (a fake screen). `menu/hookup.test.tsx` and `TerminalSessions.test.ts`: the real screen and registry with the FAKE engine of `testing.ts`. The probe: REAL xterm in WebKit and Chromium (DOM renderer).

## 4. Controls, run whole

`ui-next/shell/probes/terminal-urls-controls.sh` (from the repository root; exit 0 only when every control is seen; `FIXTURE_DIST=<dir>` reuses a build of the fixture). Result of the last run: **15 of 15 seen**, exit 0.

| half | control | seen by |
|---|---|---|
| probe (Chromium; detected with its assertion, NOT DETECTED with `ASSERTION_OFF`) | `urls-target-hidden` (the target removed from the tooltip) | `urls.target` |
| | `urls-window-open` (the click calls `window.open`) | `urls.open` |
| | `urls-text-opened` (the click opens the text, not the target) | `urls.open` |
| | `urls-file-allowed`, `urls-script-allowed`, `urls-own-allowed` (the click follows a file, a script, the host's own server) | `urls.refuse` |
| | `urls-keys-text` (the menu names a link by its text) | `urls.keys` |
| | `urls-tooltip-axe` (an image with no alternative in the tooltip) | `axe.urls` |
| source (the clean run passes, the planted source fails) | `isWebAddress` takes `file:` | links, registry tests |
| | `isOwnServer` answers no | links, registry tests |
| | the tooltip leaves the target out | hook test |
| | the registry calls `window.open` | registry test |
| | the emulator hands over any scheme (`allowNonHttpProtocols: true`) | real-emulator test |
| | `viewLinks` lists a script | real-emulator test |
| | the menu names an item `link` and not its target | menu tests |

## 5. Commands and results

Load 8 to 24 (`uptime`; a shared machine). Exit codes read, not last lines.

| Check | Result |
|---|---|
| red run, `1435dbc81` (vitest on `links`, `TerminalSessions`, `menu`, `xtermEngine`) | 44 failed, each by its assertion |
| `pnpm exec vitest run ui-next/shell/panel/terminal` (green) | 47 files, 2,312 tests, all pass |
| `tsc -p tsconfig.app.json`, `tsc -p tsconfig.test.json`, `pnpm --filter @omniviewdev/kit run typecheck` | 0, 0, 0 |
| `pnpm lint` (eslint, `lint:ui-policy`, `lint:css`) | exit 0 (8 old warnings, none in these files) |
| `node scripts/ci/probe-shards.mjs check` | ok (104 units, 57 control units, 464 controls) |
| `node ui-next/shell/probes/terminal-urls-probe.mjs`, WebKit and Chromium at 1440x900 and 1280x800, `FONT_DELAY_MS=40` | PASS, 20 assertions: the tooltip of the hyperlink whose text says `https://a.example` shows `https://b.example/login` with 0 opener calls; the Control click (WebKit on this Linux host says Linux too) opens that target once, the dev server `http://localhost:3000/` once more, `window.open` 0, `confirm` 0; `javascript:`, `file:`, the host's own origin as a hyperlink and printed show no tooltip and open nothing; Shift+F10, ArrowDown to `Open link`, ArrowRight lists `["https://b.example/login","http://localhost:3000/"]`, Enter opens the first once and the keyboard is back in the terminal; axe clean on the tooltip and on the submenu |
| `ui-next/shell/probes/terminal-urls-controls.sh` | exit 0, 15 of 15 seen (section 4) |
| the neighbouring probes the menu and tooltip change touches: `terminal-find-a`, `-c`, `-d` probes | PASS (16, 12, 12 assertions) |
| their controls, both halves: `menu-item-missing`, `menu-shortcut-drawn`, `menu-axe`, `tooltip-axe`, `links-plain-follows` | detected by their assertion; with it dropped, NOT DETECTED |
| `task local:seam -- terminal-core,terminal-find`, `SEAM_SHELL=/bin/bash`, real host, WebKit and Chromium | exit 0; `terminal-find` 45.7 s (WebKit) and 49.4 s (Chromium); the context menu list in r6 now has `Open link` after `Find` |
| `pnpm build` (the stable build) then `node --test scripts/ui-flavour.test.mjs` | build exit 0; 7 of 7 pass (the stable output holds nothing of `ui-next`) |
| `node --test scripts/ci/*.test.mjs` | 248 pass, 9 fail: `changes-workflows.test.mjs` and the aggregator tests all need `jq`, which this machine lacks ("jq is needed for these tests"); no file under `.github` or those scripts is changed here |

An attempt to run `local-checks probes` with four unit names ran 28 units (it adds the controls of every probe script it touches): after 58 groups it was stopped; the controls that failed in it were `ack-double`, `flow-late`, `ack-on-receipt`, `ack-lost`, each by ANOTHER assertion of the data path (`flood.frames`, `hidden.longtask`, `hidden.work`: a 16 MB flood and a 20 MB hidden burst at load 10 to 23), which this change does not touch [INFERENCE: load; not rerun quiet].

## 6. Not verified

- The native window (WKWebView, `Browser.OpenURL` really called): the probe asserts the call on the fixture's opener (`window.__opened`), as T3a's seam does; `window.open` and `confirm` are counted and never called.
- Windows, the Linux CI image, Safari itself and any engine but Playwright's WebKit and Chromium.
- A screen reader's reading of the tooltip and of the `Open link` submenu (axe is clean).
- A link split across the top edge of the viewport is listed by its start row only; a hyperlink that starts above the viewport and continues into it is not listed.
- Internationalised host names (a lookalike host): the target is shown as the program wrote it; no punycode normalisation is applied to what is shown or opened.

## 7. Dev tools

- `ui-next/shell/probes/terminal-urls.mjs`, `terminal-urls-probe.mjs`: the sections and the controls of the probe (`node ui-next/shell/probes/terminal-urls-probe.mjs`, `task local:probes -- terminal-urls,terminal-controls-urls`).
- `ui-next/shell/probes/terminal-urls-controls.sh`: the controls whole (section 4).
- `terminal-host.mjs`: the synthetic shell's `hyperlinks <own origin>` command (a hyperlink whose text and target differ, a script, a file, a dev server, the host's own server, and the own address printed).

## 8. Backend catalog

Nothing for the SDK or the host: the opener is `Browser.OpenURL` as before. If the host's loopback API ever moves to a port the page cannot read, the refusal in decision 2 needs the host to state it (the producer states the fact): TANGENTIAL, `ui-next/shell/panel/terminal/links/links.ts` `isOwnServer`, interim: the page's own `location`.
