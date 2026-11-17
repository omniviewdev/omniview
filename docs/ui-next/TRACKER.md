# UI migration tracker

Source of truth for the UI migration. Status files for in-flight rows live under `docs/ui-next/status/`. Agents never edit this file: the lead updates the table from the status files and adds a dated log line at the end of every session. Keep it under 150 lines.

A new session starts after `AGENTS.md`: read this file, then `decisions.md` (rulings R1–R20). Read nothing else unless a row points to it.

Last updated: 2026-11-16. Phase: **Week 1** (the kit scaffold is in review as #507; no slice on real data yet).

## Decided (2026-11-16, owner)

Batch A, all yes (`decisions.md`): new library `@omniviewdev/kit` in the omniview monorepo, old `ui` repo frozen and not imported · `ui-next` feature channel from `main` until one flip · old-shell feature freeze from the calibration gate (~week 7) · review regime = required checks + merge queue, human approval on contract paths only · licence Apache-2.0 for the plugin-facing library (confirm with the SDK licence) · safety fixes now · scope: Kubernetes, Flux, Proxmox before the flip; AWS, Containers after; marketplace web out · macOS floor 15.0. Flux and Proxmox ports: owner's team does them.

## Now (in order; each is one PR unless noted)

| # | Item | Repo | Exit test | State |
|---|---|---|---|---|
| N1 | Merge the ready fix PRs (see "Open PRs") | omniview | merged, main green | DONE 2026-11-16 |
| N2 | Set up the review regime: required checks, merge queue, CODEOWNERS on contract paths (test on a scratch repo first) | omniview | a PR cannot merge red; contract path needs approval | todo |
| N3 | Spike: `ui-next` feature channel builds from `main`, own state root, empty new entry renders | omniview | channel build launches beside stable; stable untouched | DONE #503. Build input `OMNIVIEW_UI=next`; stable output byte-identical. Not done: native app and Windows not launched; `task dev` with the variable not run |
| N3b | Make the `ui-next` channel publishable from `main` (update index entry, `resolve-channel` / `npm-publish.yml` branch rule) after the channel author answers | omniview | a signed `feature-ui-next` build installs beside stable | DONE #506: mirror workflow `mirror-ui-next.yaml` (`main` to `feature/ui-next`) and `channels.md`. The owner still registers `feature-ui-next` (`channels.md` §6); the channel workflow has never run |
| N4 | In-repo steering: `docs/ui-next/AGENTS.md` + `docs/ui-next/TRACKER.md` (the tracker lives there), lint globs/compiler/vitest cover the new tree | omniview | new tree compiled, linted, tested in CI | DONE #506 |
| N5 | Safety: remove `ResolveConfirmation` and `ListPendingConfirmations` from the bound surface; `GetConfig` stops returning the token | omniview | failing test first; plugin-realm call rejected | DONE #504 (Reveal removed, clipboard only). Open gap: raw `Call` and `Clipboard` are still exported from the shared `/runtime` surface (N15) |
| N6 | Safety: bad `activities.json` and bad recovery marker no longer fatal | omniview | failing test first; host starts with quarantined file | DONE #502 (real-app corrupt-profile run and Windows not done; one behaviour change: a quarantined marker no longer holds the plugin back on the NEXT start) |
| N7 | Delete verified-dead files, host repo part (75 files, 21,196 lines) | omniview | build + tests green | DONE #501 (host part; the plugin repos are N7b) |
| N7b | Delete verified-dead files in other repos: ledger rows D-40/41/44 (Kubernetes plugin), D-49 (AWS plugin), D-60 (`ui` library: frozen, skip) | plugin repos | build + tests green | todo |
| N8 | Baseline: `bench/app --minify on`, record numbers; turn `minify` on | omniview | numbers committed under `docs/ui-next/baseline/` | DONE in PR #508 (ready, not merged): `baseline/2026-11-16.md` + raw files. Entry chunk 23,045,947 B -> 14,554,523 B minified (brotli 4.50 -> 3.86 MB); `next` entry 62 KB brotli minified. Minify cut Chromium cold-start "interactive" 16-29%, nothing else measurable; `build.minify` is now `'esbuild'` (own commit). Timings taken at load 7-14 on 18 cores, two passes, indicative only; bytes exact. NOT measured: native `coldstart.sh`, WKWebView, parse time, scroll scenarios, real backend |
| N9 | Release Flux 0.5.0 and Proxmox 0.4.0 (already on their `main`; marketplace serves builds host 0.36 rejects) | plugin repos | marketplace serves working builds | todo |
| N10 | Spec errata pass, one owner: fix `shell-page-plugins.js:1094`, remove chapter 15 §7 dual scale, resolve the 40 disagreements (11 need the owner), untrack `node_modules`/`dist`; tag `spec/v1.0` | design-lab | tag exists; cards + goldens for slice-1 parts | todo |
| N11a | Scaffold `packages/kit`: tokens from the mock's roles (nine themes), theme engine carried over, one layer order, `Text` and `Stack`, guards, API report; `ui-next` renders a themed frame | omniview | `OMNIVIEW_UI=next` build renders the frame; stable output unchanged; typecheck, lint, tests green | DONE in PR #507 (ready, not merged; 14/14 checks green before this tracker edit). Stable output byte-identical (`diff -r`, 137 files); the `next` build runs in WebKit and Chromium and all nine themes flip by attribute; each guard proven by a failing probe. NOT verified: native app, Windows and Linux frontend builds, fonts (not delivered), first-paint script, a kit watch loop. Flags: the plugin SDK repo is AGPL-3.0 (the kit is Apache-2.0, private); `solarized-light` text is `#4C5C63` in `base.css` and `#424D54` in chapter 04 (N10) |
| N11 | Slice 1a: Pods list on real data in the channel build (the kit scaffold is N11a) | omniview (+ k8s plugin `ui-next` stream) | Pods list renders real data by week 3–4; STOP and re-plan at week 6 | todo |
| N12 | Measure: real plugin load time in WKWebView; row cost on the real table (≤3 days, rule written first) | omniview | numbers in `docs/ui-next/baseline/` | todo |
| N13 | Rehearse "abandon" once (delete the new tree on a scratch branch; list every other touch point) | omniview | removal manifest written | todo |
| N14 | Fix the timing flake in the resource graph-demand tests | omniview | Go checks stable | DONE #505 (test-only; a product gap in `connection_updates.go` is logged in its status file) |
| N16 | Licensing follows Grafana's model (owner decision 2026-11-16): the IDE stays AGPL-3.0-only; everything a plugin links against is Apache-2.0. `packages/kit` already is; check and align `packages/omniviewdev-runtime` and `packages/omniviewdev-vite-plugin` (today both say `AGPL-3.0-only`, as does `packages/omniviewdev-providers`; only the kit has a package `LICENSE` file). Add a root `LICENSING.md` listing the Apache-2.0 paths (model: Grafana's `LICENSING.md`: fetch it and mirror its structure), per-package `LICENSE` files and `license` fields. The plugin SDK relicense (AGPL-3.0 to Apache-2.0, separate repo) is for the owner and the second contributor: NOT an agent task. Must be done before the first npm publish of the kit | omniview | `LICENSING.md` at the root lists the Apache-2.0 paths; each listed package has a `LICENSE` file and a matching `license` field | todo |

Parallel-safe: N1, N2, N5, N6, N7, N9, N10 are independent. N3 → N4 → N11. N8 before N11's first measurement.

## Next (after the calibration gate, ~week 7)

Gate output: measured parts/week, review hours/part, a sized plan, flip scope, flip date; freeze starts. Then: Pod detail + Create Pod (form host) · shell parts (tabs, palette, panel, notifications/operations) · remaining Kubernetes archetypes · approvals slice with the plugin-free consent window · Flux, Proxmox · settings and plugins pages · flip · AWS, Containers.

**N15 (deferred, owner-approved): drop raw `Call` and `Clipboard` from the plugin-shared `/runtime` surface** (closes the remaining MCP-token path). Do it WITH the curated plugin surface work (ruling R11), not before. Condition from the owner: no functionality lost. First prove that no first-party plugin (Kubernetes, AWS, Containers, Proxmox, Flux at `origin/main`) and no host feature relies on them through the shared module, give host code a host-only import path, and run each plugin's build against the new surface. Exit test: plugins build and load; the names are absent from the shared-surface test.

## Open PRs (2026-11-16)

Merge now (checks green, mergeable, plain fixes): omniview **#497, #498, #500** (graph fixes), **#398** (plugin Running transitions), **#393** (test only).
Needs a decision, not a merge: **#475** (renderer sprint plan: superseded by this migration? close or fold in) · **#442** (audit gateway core: unrelated feature, large; merge before the freeze or park) · **#394 / k8s #205** (editor schemas at demand: conflicts; the editor is rebuilt in the new tree — likely close) · **#392** (perf, conflicting: rebase or close) · **#443, #471** (conflicting, stale: close).
Ordered chain, keep draft: plugin-sdk **#78** → omniview **#499** → k8s **#261** (environment fingerprints; contract change; merge and tag the SDK first).
Stale drafts to close or park: omniview #391, #395, #156; plugin-sdk #58, #63, #64; k8s #137, #203, #204, #206, #208.
Batch every wire change into ONE SDK cohort bump (fingerprints #78 + the four error-contract items).

## Waiting on the owner

B4 (11 spec rulings) and B5 (17 delete-or-design surfaces) in one message each, before the gate (`decisions.md`, "Pending"). Decide the "needs a decision" PRs above.

## Rules for every session

`main` ships exactly one product. Build through real screens; no component before its screen. No second token scale, no aliases, no shims. Failing test before a fix. Owner working trees are off limits: use `git worktree` under `~/Repos/omniviewdev/worktrees/`. Do not re-investigate settled facts; take them from your row's brief. Subagents on Sonnet, one owner per file, verify on the real surface. The full list is in `AGENTS.md`.

## Progress protocol (every agent)

Before starting a row: write `docs/ui-next/status/<row>.md` with: goal, worktree path, branch. After every meaningful step: append one dated line (what was done, what is next, any blocker). On finish: PR URL, exit-test result, what was NOT verified. A session that dies leaves that file as the resume point. The lead updates the table from the status files; agents never edit TRACKER.md.

## Log

- 2026-11-16: investigation, reviews, red team, strategy done. Design lab pushed to private `omniviewdev/design-lab` (mock tree hash `c8e44a44…`, tag `spec-baseline-2026-11-16`). Batch A decided.
- 2026-11-16: N1 done. Admin-squash-merged omniview #497 (cc356005), #498 (736f7d1e), #500 (2fb4defe), #398 (6f9f25c6), #393 (9878726a). Wire-change batching confirmed by owner (one SDK cohort bump).
- 2026-11-16: N3, N5, N6, N7 dispatched as draft PRs (agents UiNextSpike, SafetyConsent, SafetyState, DeadCode). Each keeps a status file current; the lead copies results into the table.
- 2026-11-16: owner authorised the lead to admin-merge green PRs. Merged #503 (N3), #502 (N6), #501 (N7). Ruling: NO release channel needed now — the new UI is built on `main` behind the build input `OMNIVIEW_UI=next`; the feature channel (N3b) is only needed when a packaged ui-next build must be installed beside stable, so it is deferred, not blocking.
- 2026-11-16: owner answers on the channel: (1) channels are built for long efforts tracking `main` with real release linking; (2) owner registers `feature-ui-next` himself; (3) use a MIRROR BRANCH `feature/ui-next` and the channel tooling as designed; (4) version: take the derived one as is (lead); (5) plugin channel sync reliability: investigate and document for agents; (6) state root lives as long as needed; (7) WebKit storage isolation: not a concern now; (8) channel→frontend mapping stays hard-coded in the workflow (lead: one channel does not justify more); (9) keep the single optional `ui` input on the shared build workflow (lead). N5: Reveal removed, clipboard only. Later/optional: a device-authorised MCP for the marketplace so agents can manage channels — not now. Known flake on main: `backend/pkg/plugin/resource` `TestAdvertisedConnectionPolicyWithdrawalRetiresOnlyPolicyInterest` (being investigated, row N14).
- 2026-11-16: dispatched N4 (+N3b mirror branch + channel doc), N11a (kit scaffold), N14 (flake).
- 2026-11-16: marketplace MCP handed to a separate agent by the owner. NOT part of this effort: do not pick it up here.
- 2026-11-16: merged #504 (N5): consent calls out of the plugin-shared surface, GetConfig returns no token, Reveal removed, clipboard-only. OPEN (owner): a plugin can still call CopyClientSetup via raw `Call` and read `Clipboard.Text()`, both exported from shared /runtime; no first-party plugin uses either. Not containment (R10).
- 2026-11-16: tracker moved into the repo (`docs/ui-next/TRACKER.md`) with `AGENTS.md`, `decisions.md` and `channels.md`; mirror workflow `mirror-ui-next.yaml` added (rows N4, N3b).
- 2026-11-16: N11a (kit scaffold) PR #507 ready, checks green. N3, N3b, N4, N5, N6, N7, N14 marked done (#503, #506, #506, #504, #502, #501, #505); N15 added (deferred, owner-approved); AGENTS.md carries the kit commands and the kit conventions (tokens, layers, parts, guards).
