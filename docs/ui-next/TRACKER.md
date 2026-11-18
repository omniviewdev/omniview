# UI migration tracker

Source of truth for the UI migration. The numbers and the evidence of a row are in its status file under `docs/ui-next/status/`, not here. Agents never edit this file: the lead updates it from the status files and adds a dated log line at the end of every session. Keep it under 100 lines.

A new session starts after `AGENTS.md`: read this file, then `decisions.md` (rulings R1–R20, owner decisions A1–A16). Read nothing else unless a row points to it.

Last updated: 2026-11-17. Phase: slice 1a on real data in the real host. The Kubernetes plugin's Pods list renders in the new shell from the plugin's own bundle; the shell's tab strip and page host (S1b) are in review.

## Decided (owner)

2026-11-16, batch A, all yes (`decisions.md`): `@omniviewdev/kit` in this monorepo, old `ui` repo frozen · `ui-next` feature channel from `main` until one flip · old-shell freeze from the calibration gate (~week 7) · review regime = required checks + merge queue, human approval on contract paths only · Apache-2.0 for the plugin-facing library · safety fixes now · scope: Kubernetes, Flux, Proxmox before the flip; AWS, Containers after · macOS floor 15.0. Later: A9 licensing follows Grafana's model · A10–A12 slice 1a (bounded first set, current values only, the design may be public) · A13 Kubernetes stays a plugin · A14 every control is a Tab stop · A15 test viewports 1440×900 and 1280×800 · A16 a plugin keeps its new UI in its `ui/` on `feature/ui-next`, no double pathway.

## Done (PR; the status file says what was not verified)

N1 fix PRs merged · N3 channel spike #503 · N3b mirror branch #506 · N4 steering and lint globs #506 · N5 consent calls out of plugin reach #504 · N6 bad state files not fatal #502 · N7 dead files deleted, host part #501 · N8 baseline, minify on #508 · N11a kit scaffold #507 · N11b and 1a.0–1a.7 slice 1a plan, kit atoms, table, shell frame, page chrome, Pods list mounted #509 #515–#524 · N12a native window run #526 · N14 graph-demand flake #505 · N17 optimisation inventory (`optimisations.md`) · N19 Pods scaffolding moved into the Kubernetes plugin and deleted from the host #530–#534 · N22 every control a Tab stop #528 (N22b traffic lights #529) · K1 kit registries and MiddleEllipsis #525 #527 · S1a tab and open model #533.

In review: **S1b** tab strip, page host, plugin host on the model, layout-shift check (`status/S1b.md`).

## Open

| # | Item | Note |
|---|---|---|
| 1a.8 | States and selection of the Pods list | now in the PLUGIN repo |
| 1a.9 | Columns | now in the PLUGIN repo |
| 1a.10 | CPU and memory | now in the PLUGIN repo |
| 1a.11 | Native performance pass | |
| N2 | Review regime: required checks, merge queue, CODEOWNERS on contract paths (test on a scratch repo first) | |
| N7b | Dead files in the plugin repos (Kubernetes D-40/41/44, AWS D-49) | |
| N9 | Release Flux 0.5.0 and Proxmox 0.4.0 (on their `main`; the marketplace serves builds host 0.36 rejects) | owner's team |
| N10 | Spec errata pass, one owner: 40 disagreements (11 need the owner), tag `spec/v1.0` | design-lab |
| N12 | Real plugin load time in WKWebView; row cost on the real table | |
| N13 | Rehearse "abandon" once; write the removal manifest | |
| N15 | Drop raw `Call` and `Clipboard` from the plugin-shared `/runtime` surface, with the curated surface (R11); no functionality lost | deferred by the owner |
| N16 | Licensing per A9: root `LICENSING.md`, per-package `LICENSE` and `license` fields | deferred by the owner until the first npm publish of the kit |
| N18 | Metric trends (sparklines) in lists: needs a history source, retention and sampling | after a history source exists |
| N20 | Research: component workshop and a public kit site | after slice 1a's milestone, before the gate |
| N21 | Dev utilities: every status file has a "Dev tools" heading (AGENTS rule 18); find a home for the utilities | |
| N23 | Probe viewports switch: re-measure every pinned reference at 1440×900 and 1280×800, drop 1030×720 (A15) | the S1b strip probe already runs there |
| | Session persistence: restore tabs on restart (the model saves and restores; nothing writes it yet), and each plugin's frame shape, so the frame is reserved to its real regions | S1b lists it |
| | Tab overflow menu (All tabs, S49), New tab menu (S34), tab context menu (S55), drag and reorder, pinned and preview cues | S1b lists them |

## Next (after the calibration gate, ~week 7)

Gate output: measured parts per week, review hours per part, a sized plan, flip scope and date; the freeze starts. Then: Pod detail and Create Pod (form host) · shell parts (palette, panel, notifications and operations) · remaining Kubernetes archetypes · approvals slice with the plugin-free consent window · Flux, Proxmox · settings and plugins pages · flip · AWS, Containers.

## Waiting on the owner

B4 (11 spec rulings) and B5 (17 delete-or-design surfaces), before the gate (`decisions.md`, "Pending"). Open PRs that need a decision, not a merge: #475, #442, #394 with plugin #205, #392, #443, #471; stale drafts to close or park: #391, #395, #156, plugin-sdk #58 #63 #64, Kubernetes plugin #137 #203 #204 #206 #208. Ordered chain, keep draft: plugin-sdk #78, then omniview #499, then Kubernetes plugin #261.

## Rules for every session

`main` ships exactly one product. Build through real screens; no component before its screen. No second token scale, no aliases, no shims. Failing test before a fix. Owner working trees are off limits: use `git worktree` under `~/Repos/omniviewdev/worktrees/`. Run the same commands CI runs before reporting ready. The full list is in `AGENTS.md`.

## Log

- 2026-11-16: investigation, reviews, red team, strategy done; design lab pushed to the private `omniviewdev/design-lab` (mock tree `c8e44a44…`, tag `spec-baseline-2026-11-16`); batch A decided; N1 done; N3–N7 and N14 merged; the tracker moved into the repo with the channel mirror workflow; the owner authorised the lead to admin-merge green PRs.
- 2026-11-17: the kit's atoms, table, page chrome and tooltip host merged (1a.3 to 1a.6b); the native window run (N12a); N22 and N22b; the plugin seam (N19a to N19d) moved the Pods list into the Kubernetes plugin and deleted the host's scaffolding; S1a merged the tab and open model; S1b opened (tab strip and page host).
