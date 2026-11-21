# Status: C1d (the Kubernetes plugin's kinds in the palette: aliases on its sidebar entries)

**State (2026-11-21): reworked on the lead's ruling. The plugin registers NO palette provider; its 29 kinds are rows of the host's own "Go to", found by `keywords` on its sidebar entries (the host contract's C1e member). Plugin PR #275 carries it; this host PR moves the cluster check's pin and carries this file.** The pin needs ONE MORE bump after #275 merges (section "The pin"). **Pending on the host:** the row's secondary text does not yet read the connection's NAME (section "Pending").

- Agent: K8sPalette
- Goal: the Kubernetes plugin's kinds found in the palette by the words a person types (`ns`, `po`, `svc`, `deploy`, `cm`, `sts`), opening the kind's list; no duplicate section; ranking stays the host's. No resource search (Q0's later step).
- Owns: in the plugin repository `ui/src/kinds/index.ts` (the keywords), `ui/src/palette/shortNames.ts` and its test and fixture, `ui/vendor/HOST_COMMIT` and the vendored contract; in this repository the pin line of `.github/workflows/ui-next-pods.yml` and this file. No Go.
- Worktrees: plugin `~/Repos/omniviewdev/worktrees/k8s-c1d-palette-kinds` (branch `ui-next/c1d-palette-kinds` on `origin/feature/ui-next` fdbe9c09; PR https://github.com/omniviewdev/omniview-plugin-kubernetes/pull/275); host `~/Repos/omniviewdev/worktrees/ui-next-c1d-pin-bump` (branch `ui-next/c1d-pin-bump`, on `origin/main` 01c34f02); proof helpers `host-c1d-vendor` (01c34f02, where the vendor script ran), `host-c1d-oldhost` (35e46215, a host before C1c/C1e) and `k8s-c1d-old` (the pin, fdbe9c09).

## Log

- 2026-11-20: first version (host #615 merged: the pin to 28a6ddf7): one `match` provider, "Kubernetes · Kinds", proved on the real host; the screenshot beside the mock showed the section duplicating the host's Go to, which the mock does not have.
- 2026-11-21: lead's ruling: drop the provider; the host reads aliases on sidebar nodes (C1e, #623, `docs/ui-next/status/C1e.md`). Plugin rebased on fdbe9c09, host contract re-vendored from 01c34f02, provider and its tests deleted, `keywords` on the 29 entries, tests, proof on the real host in both engines, PR retitled.

## What was built (plugin, PR #275)

- `ui/src/kinds/index.ts` `entryOf`: `keywords: [kind.kind, ...SHORT_NAMES[kind.type]]` on each kind's entry, so the skeleton and the nodes the hook answers both carry them. `Pod`, `po`: one word each, 1 to 32 characters; **no kind has more than two, so none had to be chosen out of the contract's eight** (a test holds the bounds). `list` is not one (as an alias it would be an exact name of every kind, C1e's note). A group has none (the host does not read them).
- `ui/src/palette/shortNames.ts` (21 of the 29 kinds have a short name) and `shortNames.test.ts`, kept: each is held, kind by kind, to the API discovery documents of a real server (`fixtures/discovery.json`: `kubectl get --raw` of the nine group versions the plugin lists, v1.34.0, resources only). **Source of the aliases:** `kubectl api-resources`' SHORTNAMES column is that discovery field; the mock has none (its keywords are `[Kind, plural, 'list']`), and the plugin's catalog does not carry them.
- **The plugin registers NO palette provider** and its contribution has no `palette` member (the member is optional; a test says so). Dropped: the Kinds provider, the module that published the connection and the catalog to it, and their tests. The scope-chip fix CodeRabbit asked for in the first version no longer applies (the code is gone).
- Re-vendored from omniview 01c34f02 (`ui/vendor/HOST_COMMIT`): `contract/{v1,page}.ts` and the **runtime tarball** changed; the kit tarball and `shared-specifiers.json` are byte-identical. README: one paragraph.
- Both directions: a host without keyword support loads the plugin and ignores the member (tested: the nodes are what an older host reads, and the skeleton is the same without them; run on a real older host, below).

## Pending, for the host

- **CLOSED (C1h, 2026-11-21): the row's secondary text reads the connection NAME.** Measured on a host built from `origin/main` 9c1392ec (`OMNIVIEW_UI=next`, C1g) with the plugin at fb7e5719 (#280, whose Connection face carries `role: 'connection'`), a kind cluster, WebKit and Chromium at 1440 x 900, `~/Notes/omniview/ui-migration/status/C1h-assets/proof.mjs`: a page with no group (Namespaces, Nodes) reads the name alone (`Namespaces, kind-c1h-role`); a grouped kind reads `<name> · <group>` (`DaemonSets, kind-c1h-role · Workloads`) in a window whose route carries no connection, and just `<group>` when a chip already names the connection (the chip says the name); the Tabs row says the name. The ID (`kind-c1h-role-ad2afdf19d`) is in no drawn text and no `aria-label`, `title`, `alt`, `placeholder` or value, on the list, the detail page and the open palette (the scan has a control that trips on a text holding it). The host cluster check now holds the same (`the window draws no connection ID in its text or its accessible names`, `lane.mjs` `compareDrawn`, with its negative control in `lane.test.mjs`).
- Plain Enter opens the page in the tab on screen (the same plugin and scope): the tab count stays, as C1e's seam scenario says.

## The pin

`KUBERNETES_PLUGIN_REF` moves from f4fdab1 (#272) to **fdbe9c092b31b065f0e4c82254e481fb0c4f33ab**, the head of `feature/ui-next` (#277, the plugin's Go CI: the same bundle as f4fdab1). `pin.mjs` against that checkout: "pin ok: shares the host's 6 names and was packed from a host commit that HEAD contains". **It needs one more bump after plugin PR #275 merges** (to its squash-merge commit), so that the cluster check runs the plugin with the keywords; the plugin's commit that will merge is not knowable until it does.

## Verification

State: plugin `ui-next/c1d-palette-kinds` (one commit, aa28adb3, on `origin/feature/ui-next` fdbe9c09) against a host built from `origin/main` 01c34f02 with `OMNIVIEW_UI=next task build:server`, a Go plugin binary built by the plugin's own `hack/package.sh`, browser server mode (`scripts/ui-next-pods/host.sh`), kind cluster v1.34.0. Load average at the runs 10 to 13 (shared laptop); the proof judges what the page does, not times.

- **Plugin, local:** `pnpm test` 92 files, 3,595 tests; `pnpm run lint`; `pnpm run typecheck`; `pnpm run test:scripts` 28 of 28; `pnpm run build` (type check, bundle, `check-bundle.mjs`). New tests: each of the 29 entries carries its Kind then its short names, within the contract's bounds, never on a group, the same on the hook's nodes (`kinds/index.test.ts`); no palette provider, and the nodes load on a host without keyword support (`entry.test.ts`). Seen: the changed skeleton test failed before `entryOf` carried the keywords.
- **The proof on the real host** (`keywords-proof.mjs`): WebKit and Chromium at 1440 x 900, Cmd+K and Ctrl+K (the page told it is on Linux). From another list, each of `ns`, `po`, `svc`, `deploy`, `cm`, `sts`: the page's row is the FIRST row and the active one (`aria-activedescendant`), no "Kubernetes · Kinds" section, a plain Enter opens it in the tab on screen (the tab count does not change), and its footer counts what `kubectl get <kind> -A` counts (9 Namespaces, 20 Pods, 12 Services, 7 Deployments, 46 ConfigMaps, 1 StatefulSet). `po` is the plugin's home row ("Kubernetes | Pods", which carries `po` as C1e says). `pod` shows Pods once (Kubernetes | Pods ; PodDisruptionBudgets ; HorizontalPodAutoscalers): no duplicate rows. All steps passed in all four combinations. (Escape closes the palette; the focus restore was proved by C1b/C1c and is not asserted by this script.)
- **Controls**, on the same script: the plugin's previous bundle (fdbe9c09, no keywords) on the same host fails at "the FIRST row is Namespaces" (`ns` puts DaemonSets first), in both engines. A host built at 35e46215 (before C1c and C1e) loads this plugin: its Pods list says 20 Pods (= kubectl) and the palette finds Namespaces by its label, in both engines. Not done: the control with the assertion removed (the script is a one-off in the notes, not in the shard table).
- **This pull request's cluster check, locally, on the pin fdbe9c09** (plugin packed from it, the host binary above, a fresh kind v1.35.0 with the plan's fixture): the three negative controls (fixture absent, plugin absent, bundle absent) each fail the check as they must; the check itself **6 of 6** (it holds the scope lane's Connection text to the context's name).
- Screenshot: `/Users/joshuapare/Notes/omniview/ui-migration/status/C1d-assets/keywords-and-mock-palette-webkit-void-1440x900.png` (WebKit, void, 1440 x 900: `ns` in the plugin's palette, Namespaces first, beside the mock's `ns`), the two sides alone.

## Not verified

The native window and Windows; a second real cluster; the connection name in the row (pending on the host); short names of custom resources (a table covers the built-in kinds the plugin lists; a CRD's need the catalog to carry them: a protocol change, Backend catalog); the control with the assertion removed; the host-side CI check of the palette (not written).

## Backend catalog

- **TANGENTIAL / WIRE** `pkg/plugin/resource/native_catalog.go:156` (`DisplayName: api.Kind`; `api` is the discovery's `APIResource`, which has `ShortNames`) and `packages/omniviewdev-runtime/src/resource/v2/domain.ts:57` (`ResourceType` has no short names). Evidence: `kubectl get --raw /api/v1` lists `"shortNames":["po"]` for pods. Interim: the table in `ui/src/palette/shortNames.ts`, held to a real server by `shortNames.test.ts`.

## CodeRabbit

- Plugin PR #275: the first version drew one comment (a scope chip naming an unknown connection returned all 29 kinds: product defect, fixed, answered); that code is gone in the rework. `@coderabbitai review` was asked again once on the reworked head; see the PR for its result and each answer.
- This host PR: see the PR.

## Dev tools

In `/Users/joshuapare/Notes/omniview/ui-migration/status/C1d-assets/`: `keywords-proof.mjs` (`node keywords-proof.mjs <baseURL> <kubeconfig> <first|loads> [engines] [chords] [shots dir]`; `loads` is for a host that does not read keywords), `mock-shot.mjs` (the mock's palette with a query typed), `compose.mjs` (two screenshots side by side), `goto-id-repro.md`; the first version's `palette-proof.mjs`, `palette-aliases.mjs`, `console-check.mjs`. They import Playwright and the host's `parity.mjs` from the host worktree; the paths in them are this machine's. In the plugin, `ui/src/palette/fixtures/discovery.json` is made as the header of `shortNames.test.ts` says.
