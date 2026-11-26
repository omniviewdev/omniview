# UI migration tracker

Source of truth for the UI migration. The numbers and the evidence of a row are in its status file under `docs/ui-next/status/`, not here. Agents never edit this file: the lead updates it from the status files and adds a dated log line at the end of every session. Keep it under 150 lines.

A new session starts after `AGENTS.md`: read this file, then `decisions.md` (rulings R1–R20, owner decisions A1–A22). Read nothing else unless a row points to it.

Last updated: 2026-11-21. Phase: the Kubernetes plugin's new UI runs on real data in the real host from the plugin's own bundle (`feature/ui-next`): 29 list kinds, Pod detail and nine more detail pages, Pod logs in the bottom panel with a toolbar, sidebar counts. The host has the tab strip, rail, bottom panel with a Logs tool, session restore, a visible command palette with plugin keywords, toasts, and a plugin that stops, fails or returns reaches the window. Connection IDs are unique and the UI says the name (the FLIP BLOCKER below). The credential track and the Windows fixes landed. The seam check runs in CI. The form field models and the notification centre are not wired.

## Decided (owner)

2026-11-16, batch A, all yes (`decisions.md`): `@omniviewdev/kit` in this monorepo, old `ui` repo frozen · `ui-next` feature channel from `main` until one flip · old-shell freeze from the calibration gate (~week 7) · review regime = required checks + merge queue, human approval on contract paths only · Apache-2.0 for the plugin-facing library · safety fixes now · scope: Kubernetes, Flux, Proxmox before the flip; AWS, Containers after · macOS floor 15.0. Later: A9 licensing follows Grafana's model · A10–A12 slice 1a · A13 Kubernetes stays a plugin · A14 every control is a Tab stop · A15 test viewports 1440×900 and 1280×800 · A16 a plugin keeps its new UI in its `ui/` on `feature/ui-next` · A17 closing the last tab leaves an empty window, never a trap · A18 no whole-window reload in a packaged build · A19 data follows the cluster, presentation follows the mock · A20 log sessions start from the resource · A21 a host tool's sessions survive their plugin's unload · A22 a Logs session is its plugin and its target.

## Done (PR; the status file says what was not verified)

Until 2026-11-17 (no table): N1 fix PRs merged · N3 channel spike #503 · N3b mirror branch #506 · N4 steering and lint globs #506 · N5 consent calls out of plugin reach #504 · N6 bad state files not fatal #502 · N7 dead files deleted, host part #501 · N8 baseline, minify on #508 · N11a kit scaffold #507 · N11b and 1a.0–1a.7 slice 1a: kit atoms, table, shell frame, page chrome, Pods list #509 #515–#524 · N12a native window run #526 · N14 graph-demand flake #505 · N17 optimisation inventory · N19 Pods scaffolding moved into the Kubernetes plugin #530–#534 · N22 every control a Tab stop #528 (N22b traffic lights #529) · K1 kit registries and MiddleEllipsis #525 #527 · S1a tab and open model #533.

Merged since, in order (rows from 2026-11-20 evening are grouped by step). "plugin" = `omniview-plugin-kubernetes` PR into `feature/ui-next`; "SDK" = `plugin-sdk`; every other PR is in this repository. Merge commits were read from GitHub on 2026-11-20 and 2026-11-21.

| Step | What | PR (merge commit) |
|---|---|---|
| S1b | tab strip and page host on the tab model | #535 (2846b3aa) |
| S1c | native tab-strip check (docs) | #537 (57546a43) |
| D1a | detail page in the host | #536 (7e4bd00f) |
| D1b | Pod detail page (plugin) | plugin #263 (230f12a9); status #540 (c89c3299) |
| D1c | `name` query dimension, Pod page reads one object (B-01) | plugin #264 (1f71e90f); host pin #541 (6ef3cb87) |
| S2a | activity rail, empty window (A17), no Reload when packaged (A18) | #539 (e2a6fa19) |
| P1a | bottom panel frame | #542 (ce60076a) |
| P1b-1 | `openLogStream` in `runtime/ui/v1` | #543 (424eb3ed) |
| S2b | macOS hides the main window on close (B-25) | #545 (5746bd84) |
| K2a | Workloads lists from kind definitions (A19) | plugin #265 (b8411c72); status #547 (f88c74da) |
| S3a | session restore | #546 (07d43f2e) |
| F1 | Go test flakes | #548 (f13880a8) |
| P1b-2 | kit LogView, bench, probe | #544 (be06aa2d) |
| P1b-3a | host Logs tool, `ctx.panel` (A20) | #549 (3e3a311e) |
| C1a | command palette model | #550 (924558c9) |
| E0-1 | a plugin's error sentence reaches the page (B-02) | host #551 (8b6c3bae); plugin-sdk #79 (9711e4e3, untagged) |
| K2b-1 | 8 more lists (13 kinds) | plugin #266 (76e65da0); status #552 (4c81c90d) |
| SEC1 | Secrets projected, no values (B-32) | plugin #268 (3e7bca1b); status #553 (12b138d6) |
| L1 | LogView tells every dropped line | #554 (7f1fefa2) |
| P1b-3b | Pod page opens a log session | plugin #267 (4214d04d); status and pin #555 (cf415541) |
| CI2, CI3 | failed vitest names in the job summary; bounded Playwright install with one retry | #556 (09517ba0); #557 (1a7bd5f9), merged by the owner in the web UI |
| L2 | LogView Source column | #558 (d5ecf57c) |
| C1b | visible palette with the host's providers | #559 (e6729b1d) |
| G1 | 30 kit glyphs | #560 (7795e9a6) |
| P1b-3c | host tool sessions survive plugin unload (A21) | #561 (7e340c27) |
| FM1 | form field model, not wired | #562 (d49dd4b4) |
| O1a | notices and operations model, not wired | #564 (45e12093) |
| N24-M1, E1, R1, A1, L1 | per-PR macOS build arm64 and universal on every push to main; e2e treats docs prose as prose; render benchmarks and the app profile run on their inputs; the golangci-lint config runs again | #563 (1f8d58bc), #565 (73795af7), #566 (c0e644c8), #567 (8597aba2), #570 (f7d8b5d2) |
| L3 | LogView polish, `timestamps` prop | #571 (e32cd86e) |
| N24-U1, I1 | UI checks as parallel jobs behind one aggregator, Go lint in its own job; CI image v2 (immutable tag, `image.lock`) | #575 (96afb8ce), #580 (11216274) |
| Q1 | the plugin sends counts (B-30 backend) | plugin #270 (17f69119); status #583 (77c688f6) |
| K2b-2 | 16 more lists (29 kinds) | plugin #269 (46f66f4b); status #589 (902e02cc) |
| F2, F3 | kit-probe loader-delay flake; `TestC02SourceViewLifecycle` test bug | #590 (88402b58); #596 (367b0cec) |
| N24-L2, K1, B1, D1 | Go lint blocks on changed lines; kit probes in 5 shards, then in the CI image; path gating: docs-only and new-UI-only PRs skip jobs | #597 (28774aae); #595 (ee76a1d0); #603 (c7fb5920); #607 (afd1d897) |
| Q2a | sidebar count slot in the contract | #598 (15f67c4b) |
| Q2 | sidebar counts (B-30 display) | plugin #273 (7a067665); status and pin #600 (4085166e) |
| Q2b | kit glyphs for the kinds | plugin #274 (28a6ddf7); host pin in #615 |
| DOC1 | in-repo backend catalog B-15 to B-48, tracker, AGENTS rules 23 to 32 | #611 (35e46215) |
| C1c | plugins contribute palette results through `contributionV1` (additive `palette`); providers register in rail order (a load-order swap fixed) | #612 (f9578bb3) |
| P1b-3d | a Logs session is its plugin and its target (A22); tab names unique, scope drawn only for twins | #609 (33fccdfb) |
| B41a | the MCP relay compares tool catalogs without `reflect.DeepEqual` (a data race, B-41) | #614 (f5409526) |
| C1d, C1e | the palette finds kinds by their kubectl short names: sidebar pages carry keywords, ranked as titles; the plugin registers no provider | #615 (f844c595), #626 (eb2e93b4); #623 (01c34f02); plugin #275 (700e16e0) |
| N24-K2 | probe controls may run apart from their probe, 7 shards; `page-probe`, `kit-probe-bc`, `row-menu-probe` now in CI | #616 (faa522d7) |
| H6 | unique, stable connection IDs `<slug>-<10 hex>`, the UI shows the name; Go build, vet, race tests and lint on plugin PRs to `feature/ui-next`; the FLIP BLOCKER below | plugin #272 (f4fdab1e), #277 (fdbe9c09); host pin and check #617 (b8abae2e) |
| H2, S5 | the host-plugin channel uses mutual TLS; SDK connection acquisition bounded (default 60 s, 1 to 300 s; SDK untagged) | #591 (d3c58f9c); SDK #80 (bb9981fb) |
| H5 | `profilesMu` is no longer held across a plugin's start or stop; a waiting profile transaction holds back new starts and stops | #584 (ec6cbc7f), #610 (8224ff87) |
| H1 | credential-shaped text is redacted at every host log sink | #599 (3e7efc24) |
| H3 | uninstall erases credential-class and undeclared setting values and releases cached plugin roots (B-38) | #613 (9052c470) |
| PU1 | `plugin/unloaded {pluginID, cause}` from a crash, reload, update, uninstall and turn-off; the window unloads and revives the plugin | #618 (a9eb87e3) |
| O1b-1 | toasts, the first visible slice of notifications | #619 (7eba430f) |
| CI4 | the seam check (scenarios a to p, plugin kill and revive) runs in CI, one job per engine plus every control | #624 (24a8ebfc) |
| SEC2 | an erased credential no longer stays in `settings.db`; corrupt copies pruned (B-65, B-66) | #625 (e3ee32d5) |
| N24-K3 | the shard table holds runner medians, limit 432 s derived, a drift warning (9 shards now) | #627 (aa1048df) |
| PU2 | a plugin load that fails or times out tells the window; a failed record exists, so Retry asks the host | #628 (2de6b57a) |
| C1f, C1g, C1h | the shell says a connection by its name, never the key a route carries: palette rows, then every surface and the scope face's `role: 'connection'`, then the plugin sets it | #629 (f077de42), #635 (9c1392ec); plugin #280 (fb7e5719); #640 (20679a1b) |
| CI5 | Windows CI runs the plugin roots, settings store, plugin settings and uninstall tests; found B-72 and B-73 | #630 (c1042d3b) |
| SEC3 | a channel switch seeds the other profile from an allow-list (B-70) | #631 (694017e6) |
| K2c-1 | one generic detail page for nine kinds | plugin #278 (5b0a2051); proof tools and pin #633 (2a1924ce) |
| INV1 | server mode: a page's activity session survives its events socket opening (B-08); the seam fails on an unexpected 4xx or 5xx | #632 (0e5945ba) |
| WIN1 | plugin uninstall, update and reinstall work on Windows (B-72, B-73) | SDK #81 (ae56fb09, untagged); #634 (2a03743e) |
| K2c-2 | a deleted object's page is titled "<name> was deleted" (the not-found state takes the plugin's title) | #636 (eb4997ce); plugin #279 (fa70457d); pin #638 (efef0eea) |
| INV2 | a closed server-mode page releases its window scope: the realm had 64 slots (B-44) | #639 (11a299f7) |
| P1b-4a | the Logs tool's toolbar: Follow, Pause, Clear, Copy, Local/UTC, a More menu for a short panel | #637 (d48d0dd3) |
| S-tabs | tab context menu (S55), pin and preview cues, reorder by keyboard and drag, tabs that move between windows (menu, tear-off, drop on another window), the session strip's menu and reorder, Reopen, Next and Previous tab chords, the app menu runs the shell's commands by id | #771 (8deea6b3) |

In progress: DOC2 (this fold-in). Held as draft: **R1** curated single-object read (#538, B-05). **FLIP BLOCKER** (`status/H6.md`, from the review of plugin #272): when connection IDs change from the context name to `<slug>-<hash>`, everything the host keys by connection ID is orphaned: overrides, removed connections, auto-connect choices, profile credentials and the per-connection agent policy, which fails OPEN (a connection blocked as `prod` is allowed as `prod-ea252c86a6`), and agent `resource_<hash>` tool names, which hash the ID. Not shipped (`feature/ui-next` only). The flip needs a one-time host migration, fail-closed for the agent, supplied by the plugin (the host cannot import `pkg/connid`); the design is sized in `status/H6.md`, not built.

## Next

Order of the rows below the gate: O1b notices (the centre, the operations view, the plugin producer) · kit form parts, then settings pages and Create Pod on the field model · P1b-4 log controls (the rest of the mock's toolbar) · P1c log buffer policy · detail pages beyond K2c (related tables need a `ui/v1` read of related objects, actions need B-34) and Events (B-43) · the connection-ID migration (FLIP BLOCKER) · approvals slice with the plugin-free consent window · Flux, Proxmox · plugins page · flip · AWS, Containers. Gate output (~week 7): measured parts per week, review hours per part, a sized plan, flip scope and date; the freeze starts. CI: N24 B2–B4 (consumers of the CI image by digest).

## Open (deduplicated; backend items are in `backend-catalog.md`)

| # | Item | Note |
|---|---|---|
| 1a.8–1a.10 | States, columns, CPU and memory of the Pods list | in the PLUGIN repo; CPU and memory wait for a metrics hook (B-33) |
| 1a.11, N12 | Native performance pass; real plugin load time in WKWebView; row cost on the real table | |
| N2 | Review regime: required checks, merge queue, CODEOWNERS on contract paths (test on a scratch repo first) | no check is required by a ruleset yet: the lead's merge gate (head, mergeable, every check and every `pull_request` run green, review comments answered) stands in |
| N7b | Dead files in the plugin repos (Kubernetes D-40/41/44, AWS D-49) | |
| N9 | Release Flux 0.5.0 and Proxmox 0.4.0 (on their `main`; the marketplace serves builds host 0.36 rejects) | owner's team |
| N10 | Spec errata pass, one owner: 40 disagreements (11 need the owner), tag `spec/v1.0` | design-lab |
| N13 | Rehearse "abandon" once; write the removal manifest | |
| N15 | Drop raw `Call` and `Clipboard` from the plugin-shared `/runtime` surface (R11, B-12) | deferred by the owner |
| N16 | Licensing per A9: root `LICENSING.md`, per-package `LICENSE` and `license` fields | before the first npm publish of the kit |
| N18 | Metric trends (sparklines) in lists (B-10, B-33) | needs a history source |
| N20 | Research: component workshop and a public kit site | before the gate |
| N21 | Dev utilities: every status file has a "Dev tools" heading (AGENTS rule 18); find a home | |
| N23 | Probe viewports: re-measure every pinned reference at 1440×900 and 1280×800, drop 1030×720 (A15) | |
| P1b-3d-rest | Seam scenario k's controls `double-close` and `close-twice` have no baseline check (`ui-next/plugins/e2e/seam.check.mjs:1312-1334`); a twin's scope is clipped by the strip CSS; the cluster check for twins runs in Chromium only | `status/P1b-3d.md` |
| P1b-4 | LogView, after P1b-4a: Timestamps Hidden and the inspector, source filter and badges, wrap mode, display options, jump, export, Since, Previous container, Retry on a failed session; clipboard in WKWebView and a real stream not verified; a quiet-machine cost run; two shard-table units hold one run's seconds | `status/P1b-4a.md`, `L2.md`, `L3.md`, `P1b-3a.md` |
| P1c | Log buffer policy: a cap on live lines, least-recently-viewed sessions drop their buffer and reload on reopen (B-31); about 42 MB per session today | owner note 2026-11-20 |
| PU-rest | PU1-03 and PU2-04: a stopped development plugin, a failed stop and a failed unload tell the window nothing; PU2-01: the controllers' starts have no deadline of the loader's own; PU2-02 and PU2-03: a development link whose metadata copy fails, and a reload refused before its load, leave no record; a forgotten plugin's tab keeps the page glyph (the mock: neutral glyph and recovery); B-22 is answered for the window only | `status/PU1.md`, `PU2.md` |
| L-rest | A deleted Pod ends the log session with no cause, wire level is always 0 (P1b-3b); paused feed's rate does not decay to 0; runtime source has no display label (L2-01); Chromium two-source follow p95 at its 16.7 ms limit; the plugin's Pod detail prints UTC where the mock prints a relative age | `P1b-3b.md`, `L1.md`, `L2.md`, `L3.md` |
| C1-rest | All tabs chevron (S49) and Settings gear missing from the top row; Windows unmeasured; two plugins' panel tools are ordered by load order (the race fixed for the palette in #612; branch `ui-next/r2-contribution-order` is changing it); wall-clock tests fail under load 30+ (`App.test.tsx` 5 s timeout, palette `perf.test.ts` 107 to 125 ms against its 100 ms bound) | `status/C1b.md`, `C1e.md`, `C1g.md` |
| O1b | Notices, after O1b-1 (toasts): the notification centre and history view, the operations view and the plugin producer (`ContextV1.notices`) are not built; toast placement under resize and scroll not run in a browser; the status file's verification paragraph predates its rebase | `status/O1b-1.md`, `O1a.md` |
| FM-rest | Kit form parts, settings pages; the host side needs B-34, B-46 to B-48 | `status/FM1.md` |
| S-menus | After S-tabs (#771): All tabs (S49) and New tab (S34) menus; split view (S39, S58); the session menu's Reconnect, Inspect, Move to new window and Move to window (a transfer token in the host's Go and a plugin contract to reopen a log target); a terminal rename that survives a reload; Reopen closed tab is Control Alt Shift T in the app on Windows and Linux; owner question: should a secondary window with a live session close with its last tab; Zoom, Windows, Linux and the old shell's menu not run | `status/S-tabs.md`, `status/kit-menus.md` |
| S2b-rest | Rail Tab stop lands on the last-focused entry; clicking an active tab or a panel-card link does not re-sync the rail; panel drag frame timing unmeasured natively; window is 1280×808 | `status/S2b.md` |
| S3a-rest | Native quit and relaunch not run; not restored by design: scroll, selection, search, sidebar open groups, closed-tab list, panel output, window bounds | `status/S3a.md` |
| P1a-rest | jsdom component tests; key hint on a keyboard-opened card; a late tool with the panel open shifts the strip; native window never run with the panel | `status/P1a.md` |
| K2-rest | 7 kinds keep the fallback glyph (kit lacks IngressClass, StorageClass, ServiceAccount, Role, ClusterRole, RoleBinding, ClusterRoleBinding); legacy storage-class annotation, quota cpu decimals, HPA not-yet-reported word; the glyph registry is not tree-shakeable per glyph; `status/K2a/*.txt` proof tools carry the faults fixed in K2b-1's; K2c: no related tables (they need a `ui/v1` read of related objects and a list route that takes a filter), no actions (the B-34 family), Namespace deletion conditions follow their meaning where the mock's table is inverted (errata) | `status/K2b-2.md`, `G1.md`, `K2c-1.md` |
| E0-rest | Owner: tag plugin-sdk v0.20.1 and v0.21.0 (owner list below); plugins must rebuild to send the sentence (B-02) and to get the start deadline (S5); the host pin bump then needs the three test changes of B-60 | owner |
| CI-rest | Browser-install retry not exercised in `plugin-archive-smoke.yml`; five workflows still pull the mutable `ubuntu24-v1` (no longer rebuilt); `main-macos-universal` cancels in progress, so a merge burst builds only the last commit; `Taskfile.yml:388` says `@latest` for goimports; status `*.yaml` fixtures select the full e2e run; Production profile runs twice on frontend-only changes; a new-UI push starts more jobs than the plan's 20-job cap (24 after K3, one shard more since); `kit-probe-bc`, `page-probe` and `row-menu-probe` still run at 1030×720 (N23); `kit-probe-bc` has one Linux-only height deviation (18 against 20); Kit probes' wall time moves with the runner (520, 622 and 758 s in three runs) and the 432 s limit leaves shards near it (detail probe unit 16 s); `wip/n24-k2-a` to `-c` are to delete; seam scenario o flakes under load (B-80) | `status/N24-*.md`, `CI4.md`, `INV1.md` |
| CRED-rest | The credential track's open findings: B-49 to B-64 (a refused handshake is not fail-closed in `createBackend`, start-time denial of service, overlapping auto-connect starts, `profilesMu` still couples plugins, no host start deadline, plugin traces forwarded raw, old logs unredacted) and B-69 | `backend-catalog.md` |
| WIN-rest | Windows: B-74 (an `.exe` fixture for the credential, erasure and mutual-TLS tests), B-81 to B-85 (a file opened through a held root, an uncached first lookup between two moves, a lookup after `Close`); a backend plugin with a running process, antivirus handles and a real Windows launch not run | `status/WIN1.md`, `CI5.md` |
| SRV-rest | Server mode: B-79 and B-87 (a socket reconnect loses the page's live feed), B-86 (metric and graph registries hold the same 64-slot defect), B-88 to B-90; no CI guard opens 64 pages (70 take about 70 s); the native app is believed not exposed, not run; SEC3: a real switch between packaged builds not run, B-77 and B-78 | `status/INV2.md`, `INV1.md`, `SEC3.md` |

## Waiting on the owner

B4 (11 spec rulings) and B5 (17 delete-or-design surfaces), before the gate (`decisions.md`, "Pending"). **Owner list, 2026-11-21:** (1) tag plugin-sdk v0.20.1 (#79 the error sentence, #81 the Windows file close) and v0.21.0 (#80, the 60 s start deadline); the host pin bump then deletes `internal/pluginmeta` (B-72) and changes three tests (B-60); (2) merge Kubernetes plugin #271 (base `main`, open: the inventory survives two kubeconfigs that hold one context name; #272 gave `feature/ui-next` unique IDs); (3) two settings for the CI image (`status/N24-I1.md`, "Owner actions"): Settings, Actions, General, "Allow GitHub Actions to create and approve pull requests" (or the secret `CI_IMAGE_PR_TOKEN`; the weekly CI image run goes red at its `lock` job until then), and the container package's consumer repositories and retention rule; also a token with `workflow` scope for N24 B4; (4) whether an estimated sidebar count wears a tilde: built as `~25`, named "about 25", the mock never estimates (`status/Q2.md`, row 1); (5) whether credentials cross channels on a switch (B-76; `status/SEC3.md` section 4 recommends a notice in the switch dialog and a fresh MCP token); (6) whether Clear in the Logs tool may discard lines the user has not seen: built as the mock, it clears the view and what the feed holds unread (`status/P1b-4a.md`). Open PRs that need a decision, not a merge: #475, #442, #394 with plugin #205, #392, #443, #471; stale drafts to close or park: #391, #395, #156, plugin-sdk #58 #63 #64, Kubernetes plugin #137 #203 #204 #206 #208. Ordered chain, keep draft: plugin-sdk #78, then omniview #499, then Kubernetes plugin #261.

## Rules for every session

`main` ships exactly one product. Build through real screens; no component before its screen. No second token scale, no aliases, no shims. Failing test before a fix. Owner working trees are off limits: use `git worktree` under `~/Repos/omniviewdev/worktrees/`. Run the same commands CI runs before reporting ready. The full list is in `AGENTS.md`.

## Log

- 2026-11-16: investigation, reviews, red team, strategy done; design lab pushed to the private `omniviewdev/design-lab` (mock tree `c8e44a44…`, tag `spec-baseline-2026-11-16`); batch A decided; N1 done; N3–N7 and N14 merged; the tracker moved into the repo with the channel mirror workflow; the owner authorised the lead to admin-merge green PRs.
- 2026-11-17: the kit's atoms, table, page chrome and tooltip host merged (1a.3 to 1a.6b); the native window run (N12a); N22 and N22b; the plugin seam (N19a to N19d) moved the Pods list into the Kubernetes plugin and deleted the host's scaffolding; S1a merged the tab and open model; S1b opened.
- 2026-11-18: S1b, S1c and D1a merged; the owner decided A17 and A18; Pod detail (plugin #263) merged; R1 (#538) held as draft because a single-object read is one-shot (B-05).
- 2026-11-19: S2a, D1c (B-01 closed), P1a, P1b-1 and S2b merged. S2b fixed the red light quitting the app on macOS (B-25) in every packaged build, old UI included. The backend catalog file entered the repo with rule 22.
- 2026-11-20: K2a (A19), S3a, F1, P1b-2, P1b-3a (A20), C1a, E0-1, K2b-1, SEC1, L1, P1b-3b, CI2, CI3, L2, C1b, G1, P1b-3c (A21 widened), FM1, O1a, L3, Q1, K2b-2, F2, F3, Q2a, Q2 and Q2b merged; N24 landed M1, E1, R1, A1, L1, U1, I1, L2, K1, B1 and D1. The CI queue saturated about 16:30 to 18:00 UTC: 47 PR runs waiting, oldest queued 87 min (free plan: 20 concurrent jobs, 5 macOS). Rule from it: `AGENTS.md` rules 23 and 24.
- 2026-11-20: PRs #563 and #566 merged with their `PR Validation` run cancelled before any job existed, so no check appeared and the gate counted 9 of 9 (both runs read from GitHub: `cancelled`). The lead's merge gate now needs every `pull_request` workflow run of the head to conclude success. #563 was verified after the merge: `PR Validation` run 44798544853 green, `Main macOS universal` green on 77c688f6 (17.4 min).
- 2026-11-20: B-02 fixed in code (host #551, SDK #79, untagged). B-32 closed on `feature/ui-next` (#268). B-30 closed (#270, #273). Go flake family: F1 fixed a Grafana shutdown product bug; F3 fixed a test bug (3 of 62 Go checks failed on 2026-11-20, 0 of about 370 before); `TestAdvertisedConnectionInterestOutlivesViewWithoutGraphBootstrap` not reproduced.
- 2026-11-20: P1b-3d opened (#609): a Logs press for a target that has a live session opened a twin. Plugin PR #267 sends a stable target id, so the fix is host-side.
- 2026-11-20 evening to 2026-11-21: DOC1, C1c, P1b-3d (A22), B41a, C1d to C1h, N24-K2 and K3, H6, the credential track (#584 #591 #599 #610 #613, SDK #80), PU1, PU2, O1b-1, CI4, CI5, SEC2, SEC3, INV1, INV2, WIN1, K2c-1, K2c-2 and P1b-4a merged. Rulings: kinds belong in the host's Go to rows, found through sidebar keywords, with no second palette section (C1d); a toast clock is held while its stack is not drawn (O1b-1); the SDK start deadline defaults to 60 s (S5). Findings: INV2 explained B-44 (the window realm's 64 slots never free in server mode; B-20 very likely the same); CI5's first Windows run found B-72 and B-73; the independent review of #613 found its first version failed plugin updates 25 of 25 under a concurrent lookup (0 of 200 after the fix); H6 recorded the FLIP BLOCKER.
- 2026-11-21: DOC2 folded the lead's notes into the repo: `backend-catalog.md` B-49 to B-90 (no number used twice), the step table, the FLIP BLOCKER, the owner list, AGENTS rule 25 corrected and rules 33 to 38 added, and the stale sentences of `channels.md` section 3, `status/SEC2.md` and `status/INV2.md`.
- 2026-11-23: [#678](https://github.com/omniviewdev/omniview/pull/678) unifies kit dropdown and context menus, replaces `RowMenu`, and migrates page headers, plugin details, Logs overflow and notification filters. [Status and performance evidence](status/kit-menus.md). Product work on S-menus remains open.
- 2026-11-23: [Kit progress bar, #679](https://github.com/omniviewdev/omniview/issues/679): PageOperation and plugin operations share the named 4 px track. The owning header keeps its focus and slot geometry. [Browser evidence](status/kit-progress.md).
- 2026-11-26: S-tabs merged (#771, admin merge on the owner's order): tab menus, reorder, pin and preview cues, tabs between windows, the session strip's menu, and the app menu wired to the shell's commands; `backend/menus/keybindings_v3.go` and `context_v3.go` deleted as dead. Run in the native macOS window before the six fixes of the automated review and the last merge of `main`; what was not run is in `status/S-tabs.md`.
