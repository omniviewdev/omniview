# UI migration tracker

Source of truth for the UI migration. The numbers and the evidence of a row are in its status file under `docs/ui-next/status/`, not here. Agents never edit this file: the lead updates it from the status files and adds a dated log line at the end of every session. Keep it under 150 lines.

A new session starts after `AGENTS.md`: read this file, then `decisions.md` (rulings R1–R20, owner decisions A1–A21). Read nothing else unless a row points to it.

Last updated: 2026-11-20. Phase: the Kubernetes plugin's new UI runs on real data in the real host from the plugin's own bundle (`feature/ui-next`): 29 list kinds, Pod detail, Pod logs in the bottom panel, sidebar counts. The host has the tab strip, rail, bottom panel with a Logs tool, session restore and a visible command palette. The notices and the form field models exist but are not wired. N24 (CI speed) landed in parallel.

## Decided (owner)

2026-11-16, batch A, all yes (`decisions.md`): `@omniviewdev/kit` in this monorepo, old `ui` repo frozen · `ui-next` feature channel from `main` until one flip · old-shell freeze from the calibration gate (~week 7) · review regime = required checks + merge queue, human approval on contract paths only · Apache-2.0 for the plugin-facing library · safety fixes now · scope: Kubernetes, Flux, Proxmox before the flip; AWS, Containers after · macOS floor 15.0. Later: A9 licensing follows Grafana's model · A10–A12 slice 1a · A13 Kubernetes stays a plugin · A14 every control is a Tab stop · A15 test viewports 1440×900 and 1280×800 · A16 a plugin keeps its new UI in its `ui/` on `feature/ui-next` · A17 closing the last tab leaves an empty window, never a trap · A18 no whole-window reload in a packaged build · A19 data follows the cluster, presentation follows the mock · A20 log sessions start from the resource · A21 a host tool's sessions survive their plugin's unload.

## Done (PR; the status file says what was not verified)

Until 2026-11-17 (no table): N1 fix PRs merged · N3 channel spike #503 · N3b mirror branch #506 · N4 steering and lint globs #506 · N5 consent calls out of plugin reach #504 · N6 bad state files not fatal #502 · N7 dead files deleted, host part #501 · N8 baseline, minify on #508 · N11a kit scaffold #507 · N11b and 1a.0–1a.7 slice 1a: kit atoms, table, shell frame, page chrome, Pods list #509 #515–#524 · N12a native window run #526 · N14 graph-demand flake #505 · N17 optimisation inventory · N19 Pods scaffolding moved into the Kubernetes plugin #530–#534 · N22 every control a Tab stop #528 (N22b traffic lights #529) · K1 kit registries and MiddleEllipsis #525 #527 · S1a tab and open model #533.

Merged since, in order. "plugin" = `omniview-plugin-kubernetes` PR into `feature/ui-next`; every other PR is in this repository. Merge commits were read from GitHub on 2026-11-20.

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
| CI2 | failed vitest names in the job summary | #556 (09517ba0) |
| CI3 | bounded Playwright install, one retry | #557 (1a7bd5f9), merged by the owner in the web UI |
| L2 | LogView Source column | #558 (d5ecf57c) |
| C1b | visible palette with the host's providers | #559 (e6729b1d) |
| G1 | 30 kit glyphs | #560 (7795e9a6) |
| P1b-3c | host tool sessions survive plugin unload (A21) | #561 (7e340c27) |
| FM1 | form field model, not wired | #562 (d49dd4b4) |
| N24-M1 | per-PR macOS build arm64, universal on every push to main | #563 (1f8d58bc) |
| O1a | notices and operations model, not wired | #564 (45e12093) |
| N24-E1 | e2e treats docs prose as prose | #565 (73795af7) |
| N24-R1 | render benchmarks run on their inputs | #566 (c0e644c8) |
| N24-A1 | app profile runs on its inputs | #567 (8597aba2) |
| N24-L1 | golangci-lint config runs again | #570 (f7d8b5d2) |
| L3 | LogView polish, `timestamps` prop | #571 (e32cd86e) |
| N24-U1 | UI checks as parallel jobs behind one aggregator; Go lint in its own job | #575 (96afb8ce) |
| N24-I1 | CI image v2 (immutable tag, `image.lock`) | #580 (11216274) |
| Q1 | the plugin sends counts (B-30 backend) | plugin #270 (17f69119); status #583 (77c688f6) |
| K2b-2 | 16 more lists (29 kinds) | plugin #269 (46f66f4b); status #589 (902e02cc) |
| F2 | kit-probe loader-delay flake | #590 (88402b58) |
| F3 | `TestC02SourceViewLifecycle` test bug | #596 (367b0cec) |
| N24-L2 | Go lint blocks, on changed lines | #597 (28774aae) |
| N24-K1 | kit probes in 5 shards | #595 (ee76a1d0) |
| Q2a | sidebar count slot in the contract | #598 (15f67c4b) |
| Q2 | sidebar counts (B-30 display) | plugin #273 (7a067665); status and pin #600 (4085166e) |
| Q2b | kit glyphs for the kinds | plugin #274 (28a6ddf7); host pin not bumped yet |
| N24-B1 | kit probe shards run in the CI image | #603 (c7fb5920) |
| N24-D1 | path gating: docs-only and new-UI-only PRs skip jobs | #607 (afd1d897) |

In progress: **P1b-3d** a Logs session is its plugin and its target (#609, open) · **C1c** plugin providers for the palette through `contributionV1` (spec at the end of `status/C1b.md`). Held as draft: **R1** curated single-object read (#538, B-05).

## Next

Order of the rows below the gate: O1b notices UI (rulings in the log) · kit form parts, then settings pages and Create Pod on the field model · P1b-4 log controls · P1c log buffer policy · remaining Kubernetes detail pages and Events (B-43) · approvals slice with the plugin-free consent window · Flux, Proxmox · plugins page · flip · AWS, Containers. Gate output (~week 7): measured parts per week, review hours per part, a sized plan, flip scope and date; the freeze starts. CI: N24 B2–B4 (consumers of the CI image by digest).

## Open (deduplicated; backend items are in `backend-catalog.md`)

| # | Item | Note |
|---|---|---|
| 1a.8–1a.10 | States, columns, CPU and memory of the Pods list | in the PLUGIN repo; CPU and memory wait for a metrics hook (B-33) |
| 1a.11 | Native performance pass | |
| N2 | Review regime: required checks, merge queue, CODEOWNERS on contract paths (test on a scratch repo first) | no check is required by a ruleset yet: the lead's merge gate (head, mergeable, every check and every `pull_request` run green, review comments answered) stands in |
| N7b | Dead files in the plugin repos (Kubernetes D-40/41/44, AWS D-49) | |
| N9 | Release Flux 0.5.0 and Proxmox 0.4.0 (on their `main`; the marketplace serves builds host 0.36 rejects) | owner's team |
| N10 | Spec errata pass, one owner: 40 disagreements (11 need the owner), tag `spec/v1.0` | design-lab |
| N12 | Real plugin load time in WKWebView; row cost on the real table | |
| N13 | Rehearse "abandon" once; write the removal manifest | |
| N15 | Drop raw `Call` and `Clipboard` from the plugin-shared `/runtime` surface (R11, B-12) | deferred by the owner |
| N16 | Licensing per A9: root `LICENSING.md`, per-package `LICENSE` and `license` fields | before the first npm publish of the kit |
| N18 | Metric trends (sparklines) in lists (B-10, B-33) | needs a history source |
| N20 | Research: component workshop and a public kit site | before the gate |
| N21 | Dev utilities: every status file has a "Dev tools" heading (AGENTS rule 18); find a home | |
| N23 | Probe viewports: re-measure every pinned reference at 1440×900 and 1280×800, drop 1030×720 (A15) | |
| P1b-3d | one session per (plugin, target); tab scope for twins; axe `label-content-name-mismatch` on scoped session tabs | #609 |
| P1b-4 | LogView: Timestamps control (Local, UTC, Hidden) and inspector, source filter and badges, wrap mode, Retry on a failed session | `status/L2.md`, `L3.md`, `P1b-3a.md` |
| P1c | Log buffer policy: a cap on live lines, least-recently-viewed sessions drop their buffer and reload on reopen (B-31); about 42 MB per session today | owner note 2026-11-20 |
| P1b3c-01 | Nothing in the product unloads a ready plugin: `PluginStore.unload`, and `ReloadPlugin` emits none of its three declared events (B-22) | A21 is not reachable by a user yet |
| P1b-3b | A deleted Pod ends the log session with no cause; wire level is always 0 | `status/P1b-3b.md` |
| L-rest | Paused feed's rate does not decay to 0; runtime source has no display label (L2-01); Chromium two-source follow p95 at its 16.7 ms limit; the plugin's Pod detail prints UTC where the mock prints a relative age | `L1.md`, `L2.md`, `L3.md` |
| C1-rest | C1c; All tabs chevron (S49) and Settings gear missing from the top row; New window; Next and Previous tab have no chord; Windows unmeasured | `status/C1b.md` |
| O1b | Notices UI. Lead rulings of 2026-11-20, not yet in a status file: failure toast sticky 8 s; history 500 records or 7 days (the mock says 200 records, `status/O1a.md`); optional `ContextV1.notices` producer; per-source mute only | `status/O1a.md` |
| FM-rest | Kit form parts, settings pages; the host side needs B-34, B-46 to B-48 | `status/FM1.md` |
| S-menus | Tab overflow menu (All tabs, S49), New tab menu (S34), tab context menu (S55), drag and reorder, pinned and preview cues | `status/S1b.md` |
| S2b-rest | Rail Tab stop lands on the last-focused entry; clicking an active tab or a panel-card link does not re-sync the rail; panel drag frame timing unmeasured natively; window is 1280×808 | `status/S2b.md` |
| S3a-rest | Native quit and relaunch not run; not restored by design: scroll, selection, search, sidebar open groups, closed-tab list, panel output, window bounds | `status/S3a.md` |
| P1a-rest | jsdom component tests; key hint on a keyboard-opened card; a late tool with the panel open shifts the strip; native window never run with the panel | `status/P1a.md` |
| K2-rest | Host pin to plugin 28a6ddf7 (Q2b); 7 kinds keep the fallback glyph (kit lacks IngressClass, StorageClass, ServiceAccount, Role, ClusterRole, RoleBinding, ClusterRoleBinding); legacy storage-class annotation, quota cpu decimals, HPA not-yet-reported word; the glyph registry is not tree-shakeable per glyph; `status/K2a/*.txt` proof tools carry the faults fixed in K2b-1's | `status/K2b-2.md`, `G1.md` |
| E0-rest | Tag plugin-sdk (v0.20.1) or fold into the cohort; plugins must rebuild to send the sentence (B-02) | owner |
| CI-rest | Browser-install retry not exercised in `plugin-archive-smoke.yml`; `row-menu-probe` never runs in CI and fails with 196 `aria-expanded` findings; `kit-probe-bc` and `page-probe` pass and should join a shard; `probe-shards.test.mjs` fails 1 of 49 with `FONT_DELAY_MS=40` exported; five workflows still pull the mutable `ubuntu24-v1` (no longer rebuilt); `main-macos-universal` cancels in progress, so a merge burst builds only the last commit; `Taskfile.yml:388` says `@latest` for goimports; status `*.yaml` fixtures select the full e2e run; Production profile runs twice on frontend-only changes | `status/N24-*.md` |

## Waiting on the owner

B4 (11 spec rulings) and B5 (17 delete-or-design surfaces), before the gate (`decisions.md`, "Pending"). Allow Actions to create pull requests or add `CI_IMAGE_PR_TOKEN` (the weekly CI image run goes red at its `lock` job until then, `status/N24-I1.md`); a token with `workflow` scope for N24 B4. Open PRs that need a decision, not a merge: #475, #442, #394 with plugin #205, #392, #443, #471; stale drafts to close or park: #391, #395, #156, plugin-sdk #58 #63 #64, Kubernetes plugin #137 #203 #204 #206 #208. Ordered chain, keep draft: plugin-sdk #78, then omniview #499, then Kubernetes plugin #261.

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
