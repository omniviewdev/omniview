# Status: KL8 (the host's cluster check pins plugin #292, the landing's navigator)

- Agent: LandingPin
- Goal: plugin omniview-plugin-kubernetes#292 gave the plugin's landing a sidebar of its own (the navigator of its connections), the connection verbs in a menu, platform and region facets and cards grouped by platform; it contains #290 (a connection's labels, namespaced, from its kubeconfig with no network call) and #291 (what a connected cluster says about itself, with the metadata keys renamed to the labels'), and it was vendored from this branch's base. This row moves the pin of `.github/workflows/ui-next-pods.yml` from #289 (`9dfe6403`) to `2ae3524f20e24703c640614923e6f69212459e04`, the head of the plugin's `feature/ui-next` on 2026-11-26 (`gh api .../compare/<pin>...feature/ui-next` says `identical`). The plugin's author read the check against the new landing and expected only stale comments to need fixing ("the landing has no sidebar"); that was unproven, so the whole check was run, step by step as the job runs it, and each statement of that reading was looked at on the real page.
- Worktree: host (this change) `~/Repos/omniviewdev/worktrees/landing-pin-2`; plugin, detached, for the local runs: `/tmp/landing-pin/omniview-plugin-kubernetes` (the pin).
- Branch: `feat/landing-pin-2`, from `origin/main` 6d459b84d. Nothing committed, pushed or opened as a PR: the lead does that.
- Not docs-only, and not new-UI-only: the workflow file changes, so CI classifies the PR as `all` (rule 32), as it does for every pin bump. The check runs at night and on request, never on a pull request (rule 39): `gh workflow run ui-next-pods.yml --ref feat/landing-pin-2` is the run that is still to be done on GitHub's runner.

## Result

The reading was right: **nothing in what the check does needed to change.** With the pin moved and no other change, the whole flow passed (every step and every negative control); the comments the new landing made stale were then corrected and the whole flow was run again on the final tree: every step passes (table below). Nothing fails, so there is no failure to compare with the old pin; the check's code is the one that passed against #289 in KL3 (the final tree of that row ran against that pin), and it passes against #292 as it was.

## What changes

- `.github/workflows/ui-next-pods.yml`: `KUBERNETES_PLUGIN_REF` is the pin above, and the pin comment says what #290 to #292 are (vendored from host main 6d459b84d, #780 to #783), that the check presses the connection in the landing's table, that the navigator lists it too and the check does not read the navigator, and that this bump changed no line of what the check does, only what its comments say of the landing (the sentence of the bump rule, kept true). `node scripts/ui-next-pods/pin.mjs <checkout at the pin>` accepts the pin ("pin ok": the plugin's six shared names are the host's, and `ui/vendor/HOST_COMMIT` is 6d459b84d, this branch's head).
- `scripts/ui-next-pods/landing.mjs` (comment): the landing has no scope lane, and it has a sidebar, the navigator, a navigation named `Kubernetes connections` (a connection's own pages keep the tree of their resources, `Kubernetes resources`); each connection is a leaf of it, a tree item and not a button; the check reads the table and nothing of the navigator; and the Kubernetes cell of a row that is not connected may say the last version the host kept for it, drawn muted, and a dash only when it kept none.
- `scripts/ui-next-pods/parity.mjs` (four comments, no code): `openConnection` (the landing "has no sidebar"), `openPods` (a window with no row has no plugin page, so no sidebar of the plugin's), `openFromLanding` (why the press is scoped to the table: the navigator lists the connection too), `choosePods` ("a window with no sidebar" is a window with no tree of the resources: the landing has a sidebar, the navigator).
- `scripts/ui-next-pods/unavailable.test.mjs`: the sibling fact the unit test puts in the host's envelope is `kubernetes.server.version`, the key the plugin states since #291 (`kubernetes.server_version` is not stated any more); the data of the test, not a rule.
- No new workflow step, job or unit; nothing listed in `scripts/ci/probe-units.manifest.json` is touched (`node scripts/ci/probe-shards.mjs check`: `ok (96 units, 53 control units, 432 controls, 43 probe scripts)`; `scripts/ci/changes.test.mjs`, `changes-workflows.test.mjs`, `check-image.test.mjs` and `main-red.test.mjs`: 120 of 120; `actionlint` and `yamllint` of the workflow clean; `eslint scripts/ui-next-pods`: exit 0).

## What was looked at on the real page (the statements of the reading)

Chromium, a fresh host (`host.sh`, a home of its own) with the plugin built from the pin, a kind cluster with the fixture (`explore-landing.mjs.txt`).

| Statement | Found |
|---|---|
| One visible region `Connections` | `getByRole('region', { name: 'Connections', exact: true })` counts 1 while the landing is on screen and 0 while the Overview is (the landing is kept, hidden); no other region of that name |
| Headers | `Connection`, `Status`, `Kubernetes`, `Region`, `Actions` |
| The name is the row's first button | the first `button` of the row is the name; the page holds one button named by the connection, one tree item and one cell |
| Cells | before the press `Disconnected`, `—`, `—`, `Open`; after it (the landing read again from its tab) `Connected`, `v1.35.0`, `—`, `Open` |
| The landing's sidebar | a `nav` and a `tree` named `Kubernetes connections`: `Kubernetes`, `All connections 1`, `Connected 0` (1 after the open), `Needs attention 0`, the group `Connections 1` (expanded) and the leaf `<context>`; no scope lane |
| A connection page's sidebar | a `nav` and a `tree` named `Kubernetes resources` (Overview, Nodes, Namespaces, Workloads, Config, Network, Storage, Access control); the lane says `Connection: <context>`. Only one of the two trees is in the DOM at a time, so the landing's selected leaf never reaches the Overview's `current` reading |
| A locator by the connection's name may match twice | by text, yes (2 on the landing before the open: the navigator's leaf and the table's button); by role, no: a `button` of that exact name is 1 on the page (the leaf is a `treeitem`), and the check's press and its reading are scoped to the table (`openFromLanding`, `readLandingDom`) |

What else the pin changes, looked at the same way:

- **The facts.** The real keys of a connection with the pin (`facts.mjs.txt`, the host's envelope, a cluster with the unavailable group registered): `kubernetes.server.version` (`v1.35.0`), `kubernetes.server`, `kubernetes.server.platform`, `kubernetes.platform` (`kind`), `kubernetes.platform_source`, `kubernetes.distribution`, `kubernetes.distribution_source`, `kubernetes.cluster.uid`, `kubernetes.user.name`, `.groups`, `.cluster_admin` and `kubernetes.unavailable_api_groups`, all `current`. The one fact the check reads, `kubernetes.unavailable_api_groups`, is unchanged: `{"count":1,"groups":[{"groupVersion":"inv4-unavailable.example.com/v1beta1","reason":"stale"}]}`. `kubernetes.server_version`, `kubernetes.server_url` and `kubernetes.provider` are not stated any more.
- **The ID.** The check's C1h test reads what the window draws and names, with a connection's page on screen, and never has the landing's navigator in the DOM. Read on the landing (`explore-id.mjs.txt`, `readDrawn` of the check) before the open, with the Overview on screen and after: no text and no accessible name carries the derived ID. It is in the DOM only as a key: the `data-id` of the navigator's leaf, the `data-ov-menu-key` of the row and of its menu button, and the `href`s of a connection page's links (as before). Nothing was added to the check for it.
- **Last known.** A host restarted on a home that kept the connection's last answer (#783; `explore-last-known.mjs.txt`) says `Disconnected` and `v1.35.0`, drawn muted (`data-last-known`, tip "Last known value. It may be out of date.") in the row before anything is opened. The check's hosts start on a home of their own and the one assertion about the landing is made on the first open of the connection, so the version of its `Connected` row has been read from the live cluster in that run; the assertion reads the cell's text and would not tell a last-known version from the live one, which matters only if a flow ever restarts a host on a kept home. Not changed.
- **The press.** The connection is opened from the landing as before: a new tab `Overview, <context>` beside the landing's `Kubernetes`, two tabs, the Overview on screen.

## The job's flow, run locally from a clean environment

macOS arm64, the steps of the workflow in its order (`run.sh.txt`): the checks under `env -i PATH HOME TMPDIR` with only their three `OMNIVIEW_CHECK_*` variables (no `ENGINES`, `VIEWPORTS`, `NEGATIVE_CONTROL`, `REPORT` or `DIST`), the kit built by `task packages` and the host with `OMNIVIEW_UI=next`, the plugin built from the pin by its own `hack/package.sh <version> darwin_arm64`, a new kind cluster (kind v0.30.0, node image v1.35.0 by the job's digest, kubectl v1.35.0 checked by its published sha256), four hosts on ports 24401 to 24404 with private homes, and the cluster deleted at the end by its exact name. Chromium is the one engine: the check launches `chromium.launch()` and has no other. This run is on the final tree (the first run, with only the pin moved, passed the same steps with the same counts: 170, 2, 2, 2, 14, 1, 1).

| Step | `uptime` before (1, 5, 15 min) | Result |
|---|---|---|
| Contracts that need no cluster (`node --test scripts/ui-next-pods/*.test.mjs`) | 4.54 3.84 4.11 | 170 of 170, 12.8 s |
| Check the pin | 4.12 3.78 4.09 | `identical`; "pin ok" |
| Packages, host (`OMNIVIEW_UI=next`, server mode), plugin | 4.12 3.78 4.09 | 23 s |
| kind cluster | 5.25 4.05 4.18 | 25 s |
| Control, cluster without the fixture | 6.42 4.50 4.33 | 2 of 2, 0.38 s |
| Fixture (25 Pods) | 6.42 4.50 4.33 | 9 s |
| Control, host without the plugin | 6.55 4.59 4.37 | 2 of 2, 58.5 s (36.5 + 21.5: the 20 s click on a row that does not exist, then the 15 s comparison, as before) |
| Control, the plugin without its bundle | 4.88 4.51 4.35 | 2 of 2, 54.8 s (38.0 + 16.6) |
| Check that the page and kubectl agree (parity mode) | 3.24 4.11 4.22 | 14 of 14, 41.6 s |
| Control, a cluster without the unavailable API group | 4.72 4.35 4.30 | 1 of 1, 0.33 s |
| Check that the connection starts with an unavailable API group | 4.72 4.35 4.30 | 1 of 1, 2.6 s; 2 cancelled queries let through (the allowance of `unavailable.mjs`; 1 to 3 with #289, KL3) |

The Overview test of that run: "the page was sampled every 10 ms from the press: 37 samples read 13 distinct pages, 9 of them with a row that was Loading (19 samples), and it settled 263 ms after the press" (the press is the one on the connection in the landing; KL3: 37, 13, 10, 251 ms). The job's `timeout-minutes` is 30; the steps that dominate it (cluster, builds, browser install) are not touched. The machine was shared (load 3 to 6.5): no timing here is a benchmark (rule 27).

## Controls (rule 28)

- The job's own four controls, on the final tree: each passes, so each fails the check for the reason it is named for (their tests assert the code): `control-fixture-absent` 2 of 2 (`FIXTURE_MISSING` for both checks), `control-plugin-absent` 2 of 2 (`PAGE_MISMATCH` with no rows at the kit's empty state "No Plugins"; `OVERVIEW_MISMATCH` with `pressed: false`), `control-bundle-absent` 2 of 2 (`PAGE_MISMATCH` and `OVERVIEW_MISMATCH` at "Couldn't load Kubernetes", `pressed: true`, no section, the rail's entry "Kubernetes, did not load"), `control-group-absent` 1 of 1 (`GROUP_MISSING`). The landing's new sidebar changes neither: the plugin-absent window has no row to press and the bundle-absent page is not the landing.
- The landing's assertion on the real page with the pin, one fault at a time in a scratch copy of the check, against a fresh host, the unmutated check passing on the same host first (`mutants-real.sh.txt`): a wanted version of `v0.0.0` fails with `LANDING_MISMATCH: version: the landing says the Kubernetes version of "kind-landing-pin2-x" is "v1.35.0", kubectl says the server is v0.0.0`; a wanted state of `Online` fails with `LANDING_MISMATCH: state: the landing says "kind-landing-pin2-x" is "Connected", wanted "Online"`; a connection pressed by a name that is not listed fails with `LANDING_MISMATCH: listed: the table lists "kind-landing-pin2-x", wanted one named "kind-landing-pin2-x-x", the context kubectl calls current`; the landing's tab wanted under another title fails with `OVERVIEW_MISMATCH: tab: the window's tabs are ["Kubernetes", "Overview" on screen], wanted two tabs: the plugin's landing, titled "Kubernetez", ...`.
- The 17 unit faults of KL3 (`KL3/mutants.mjs.txt`, its two paths pointed at this worktree), each planted alone in a scratch copy of `scripts/ui-next-pods`: 17 of 17 are caught by the control named for the rule (`landing.mjs` 9, the tab rule of `overview.mjs` 5, `linkTo` 3).

## Not verified

- The job on GitHub's runner (`ubuntu-24.04`, the `linux_amd64` plugin, kubectl and kind for Linux, Playwright's Chromium from `playwright install --with-deps chromium`): CI answers it, on request, after the push. Here: macOS arm64, a `darwin_arm64` plugin, Node v26.12.0 (the job's 26.13.0), Go 1.27.4 (the job's 1.27.3, `GOTOOLCHAIN=local`), the Playwright 1.64.1 the repository brings.
- WebKit and Firefox: the check is Chromium only.
- What the check does not open of the landing: the navigator (no assertion about it was added: this row fixes what the new plugin makes necessary), several connections, the page of all of them (`View all`), the facets, the cards, the verbs of the menu. The check's kubeconfig has one context.
- The check against the previous pin with this tree: not run; the code is the one KL3 ran against #289 and only comments and one test literal differ.
- The full root `pnpm test`, `pnpm lint`, the kit's `verify`, the kit and shell probes and the seam: nothing under `ui-next/` or `packages/kit/` changed, and CI runs them at night.

## Dev tools

`docs/ui-next/status/KL8/` (drop the `.txt`; the paths are those of this run, under `/tmp/landing-pin`): `run.sh.txt` (the workflow's flow on a kind cluster of my own: contracts, pin, builds, cluster, the four hosts, the four controls, the main check and `unavailable-group`; it deletes the cluster `landing-pin2-<run>` it made, by that exact name, and stops its hosts by their pid files), `mutants-real.sh.txt` (the four real-page faults in a scratch copy of the check, against a running host and cluster), `explore-landing.mjs.txt` (what the landing and the Overview draw: tabs, navigations, trees, regions, the lane, and how many elements the connection's name finds by role and by text), `explore-id.mjs.txt` (where the derived ID occurs on the landing), `explore-last-known.mjs.txt` (the landing's row on a host restarted on a kept home), `facts.mjs.txt` (the host's facts for a connection). The unit faults are `KL3/mutants.mjs.txt`.

## Log

- 2026-11-26 01:35 (load 7.09 4.44 4.59): worktree `landing-pin-2` at `origin/main` 6d459b84d, `pnpm install --frozen-lockfile` 1.5 s, `task packages` 13 s, the shim restored. The plugin cloned and checked out at the pin; read its `ui/src/landing/` (navigator, home, list, collection, parts, facts, model) and the diff against #289 (the fact keys renamed in `overview/facts.ts` and `connection_metadata.go`; the sidebar hook's navigator).
- 01:37 (load 3.18 3.86 4.34): the first full run with the pin moved and nothing else: every step passes (170 of 170, 2, 2, 2, 14, 1, 1).
- 01:43 to 01:50: the landing, the ID, the last-known row and the facts looked at on a host of my own (tables above); the four stale statements found (`landing.mjs`, three places of `parity.mjs`) and corrected, with the pin comment and the test literal; the four real-page faults (the first attempt of the script had an apostrophe in a `${...:?}` word and never ran a check; fixed and rerun).
- 01:50 (load 4.54 3.84 4.11): the whole flow on the final tree, from a clean environment: every step passes (table above); then the 17 unit faults, the CI script tests and the manifest check.
- The kind clusters this made (`landing-pin2-first`, `landing-pin2-x`, `landing-pin2-final`) are deleted by their exact names; every host this started is stopped (the restart host by its pid, which `lsof` gave for its port). The stray `bin/Omniview-server` of Nov 17 was never touched.

## Backend catalog

Nothing new for the SDK, a plugin backend or the host's Go side.
