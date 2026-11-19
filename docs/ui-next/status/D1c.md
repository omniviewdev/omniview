# Status: D1c (the proper fix for the Pod page's read: `name` is a query dimension of every native kind of the Kubernetes plugin)

- Agent: LiveObject (D1c), with the sub-agent HostPodCheck for the host's cluster check
- Goal: a page can open a LIVE source view narrowed to ONE object (`scope [{namespace oneOf [ns]}, {name oneOf [name]}]`), so the Pod detail page stops watching its whole namespace (D1b: 489 ms, 4.7 MB and about 4 MiB per tab at 600 Pods). Backend catalog item B-01 / D1b-1, class BLOCKER. The plugin issues ONE narrowed LIST and WATCH (a `metadata.name` field selector), not a namespace watch filtered on the client. No SDK or wire change.
- Worktrees: plugin `~/Repos/omniviewdev/worktrees/kubernetes-ui-next-d1c-name-dimension`; host (this file) `~/Repos/omniviewdev/worktrees/ui-next-d1c-host`; proof host `~/Repos/omniviewdev/worktrees/ui-next-d1c-proof-host` (detached at origin/main c89c3299, built with `OMNIVIEW_UI=next`); BEFORE plugin `~/Repos/omniviewdev/worktrees/kubernetes-d1c-before-230f12a` (detached at the pin); `kubernetes-pin-230f12a` (HostPodCheck's, same commit)
- Branches: plugin `ui-next/d1c-name-dimension` (PR https://github.com/omniviewdev/omniview-plugin-kubernetes/pull/264, **base `feature/ui-next`**, squash-merged as `1f71e90f2807c3dad59182281830ce19ed58ea1f`); host `ui-next/d1c-status` (this PR)
- Base: plugin `feature/ui-next` 230f12a9 (the D1b merge); host `origin/main` c89c3299 (the D1b status merge)
- PR: see the pull request of this branch (ready, not merged)

## Log

- 2026-11-19: read D1b.md and R1.md, the pinned SDK (v0.20.0: `ValidateScope`, `scopeContains`, `AdmitCatalogOperation`, `SourceOperationalContractEqual`) and the host's `ResolveTarget`/`normalizeQueryScope`/`prepare`: nothing in the SDK, the wire or the host has to change (checked below, not assumed).
- 2026-11-19: plugin worktree made; tests first for the catalog, the informer, `Source`, Enumerate/NativeQuery, the type-level action and `usePod` (red: the SDK says "unknown query dimension" for a narrowed read, `Source` refuses a `name` scope); then the change; the whole `go test ./...` green; pushed early; PR #264 opened, `@coderabbitai review` asked once (the base is not the default branch).
- 2026-11-19: own kind cluster `d1c-name-dimension` (v1.35.0, private kubeconfig), the slice fixture, the D1b `rich` Pod and a throwaway namespace `bulk` of 600 Pending Pods. A counting transport on a real client: the narrowed source asks the server for one object (table below).
- 2026-11-19: host built from `origin/main` with `OMNIVIEW_UI=next`; BEFORE (the pin) and AFTER (PR #264) plugin packages on two clean hosts; the D1b proof run against both (values, delete-while-open, the cost table). The host's cluster check bumped to the pin and extended with the Pod detail (HostPodCheck).
- 2026-11-19: plugin PR #264 squash-merged into `feature/ui-next` as `1f71e90f`. This PR now pins the cluster check to it (`pin.mjs` ok against that checkout: the plugin shares the host's 6 names and was packed from a host commit HEAD contains), so the check opens the Pod page on the name-narrowed read; the cluster check itself was not re-run locally for the new pin, CI runs it. It also adds a fast guard for the `dist/.gitkeep` trap (section below).
- 2026-11-19: host PR #541: the job "Pods cluster check" is green on GitHub's runner (linux_amd64, 6 min 59 s) with the pin and the new detail comparison; "Windows connection profiles" failed once (2 min 25 s; the PR changes one markdown file, one workflow and `scripts/ui-next-pods`, and its log was not readable while the run was in progress) and passed on the re-run after the next push. CodeRabbit left 2 comments on this PR, both valid and fixed: the proof commands now run from their owning worktrees (this file), and `checkDetail` brackets each page reading with two reads of the Pod, so a StatefulSet Pod replaced during the poll (same name, new IP) is read again instead of failing; "Pods cluster check" is green again with that change (6 min 16 s). CodeRabbit reviewed plugin PR #264 and left no comment.

## What was built

All in the plugin, PR #264 (`pkg/plugin/resource/**`, `ui/src/pod/data/usePod.ts`).

- **The catalog** (`native_catalog.go`, `native_catalog_assembly.go`, `native_provider.go`): `name` joins the QUERY dimensions of every kind built from discovery, never the identity (an object stays namespace + id); every capability of the kind is declared over `{namespace as the connection reads it, name any}` (`nativeServedScope`). `AllowEmpty: false` (the D1b write-up said `true`): no object has an empty name, so the SDK itself refuses `name oneOf [""]` as `INVALID_REQUEST`.
- **One narrowed watch** (`clients/clients.go`, `clients/object_name.go`): `AcquireInformer(..., clients.ObjectName(name))` builds the dynamic informer with a `metadata.name` field selector, so the LIST and the WATCH are the server's own selection. The informer key is (namespace, name, resource): two tabs on one Pod share one native watch (lease counted), another Pod is another narrowed watch, the namespace informer is untouched. **This differs from the D1b write-up** ("keep one shared informer per (namespace, resource) and filter by name"), on the lead's instruction: a detail tab no longer shares the list's informer; it costs one small LIST probe and one WATCH per distinct Pod open, in exchange for never receiving or holding the namespace. `clients.NameSelector` is the one place a name becomes a selector: one escaped term (`a,metadata.namespace=other` cannot add a term), and a name no object can have (empty, `.`, `..`, `/`, `%`, invalid UTF-8) is `INVALID_REQUEST` before the API server is asked anything.
- **`Source`** (`resourcers/base.go`): reads the namespace and name constraints (an omitted dimension and `any` select every value; a scope that repeats or misnames a dimension is refused), probes and acquires one informer per (namespace, name); a second line behind the server's selection keeps the source inside its scope even if a server ignored the selector.
- **The finite reads** (`native_read.go`): Enumerate and the label query take the same selection: one List per namespace x name, the cursor resumes by slot (cursor version 3), the cursor binding covers the names. A type-level action (`editor_actions.go`) takes the namespace and refuses a name.
- **The UI** (`ui/src/pod/data/usePod.ts`, one file, and its tests): scope `namespace` + `name`; the not-found rule (absent from the complete snapshot; a `remove` while open) and the address check are unchanged.

**Which kinds.** Covered: every kind of `discoverNativeTypes`'s loop (core, apps, every CRD; namespaced and cluster-scoped), because `Source` and the finite reads are the generic ones. Not covered: `helm:*`, `audit:polaris` and the editor-query type (registered beside them, own dimensions, tested unchanged). An aggregated API that does not implement the `metadata.name` field selector fails its source at the probe with a classified error and Enumerate refuses a server that answers with other objects; not exercised against a real aggregated API.

**SDK and wire: none, verified.** `queryDimensions` and `ScopeConstraint` are in the descriptor at SDK v0.20.0. The plugin's tests ask the SDK's own admission (`AdmitCatalogOperation`) whether a narrowed source, a narrowed enumerate, a Get and a mutation of an exact object are admitted (yes, for a namespaced, a cluster-scoped and a CRD kind; for a connection with explicit namespaces only inside them), and `SourceOperationalContractEqual` whether a source opened before the upgrade is fenced (yes: it reopens once, the catalog revision moves). The host: `ResolveTarget` fills an omitted dimension with `any` (`finite_service.go` `normalizeQueryScope`), graph demand and observation fill every declared dimension with `any` (`graph_demand.go:389`, `observation.go:178`), `prepare` admits the narrowed target as a `ReadTarget` (`source_coordinator.go:258`); the AFTER host below opened the narrowed view unchanged.

## Results

Surface: the browser server mode of the host (**not** the native window), WebKit 27.2 for the times and Chromium for the heap, macOS arm64, 2026-11-19. Host: `origin/main` c89c3299 built with `OMNIVIEW_UI=next` (`dist/index.html` is "Omniview ui-next"), `OMNIVIEW_CHANNEL=feature-ui-next`, a clean `HOME` per host. Cluster: kind v1.35.0, one node, the slice fixture + `rich`; `bulk` = 600 Pending Pods (`d1b-fixtures/bulk-600-pending-pods.json`). BEFORE = the plugin at the pin 230f12a (`entry.js` sha256 `a73b1aa6…`, the D1b final bundle); AFTER = PR #264 (`entry.js` `c1d87138…`).

| # | Check | Result |
|---|---|---|
| 1 | Plugin Go: `GOWORK=off GOTOOLCHAIN=local go test ./... -count=1` | all packages green |
| 2 | Plugin UI: `pnpm exec vitest run src/pod` (and the PR's CI job "UI checks") | 490 tests; the PR check green (25 s) |
| 3 | **One narrowed watch, on a real API server** (`OMNIVIEW_PROOF_KUBECONFIG=… OMNIVIEW_PROOF_POD=bulk-0300 go test ./pkg/plugin/resource/resourcers -run OnARealCluster -v`; a counting transport on the plugin's client, compression off) | below |
| 4 | **Values equal `kubectl`** on the AFTER host: a healthy (`cart-api-86bf766589-4szhw`), a crash-looping (`crashloop`), a pending (`unschedulable`), an image that cannot be pulled (`bad-image`), one with every section (`rich`): the oracle (`kubectl get pod -o json`) and `kubectl describe pod`, as D1b | 5 of 5 PASS (chip, summary, facts, lane). The D1b stages `--all`, `control`, `secrets`, `nav`, `states` were not re-run: the page code is the same bundle but for `usePod.ts` |
| 5 | **`kubectl delete pod` while the page is open**, AFTER host | PASS both ways. Graceful: "d1b-victim was not found · Pod d1b-victim doesn't exist in namespace checkout. It may have been deleted." after 30,429 ms (D1b: 30.7 s); forced: after 189 ms (D1b: 187 ms). The tab is kept with its title, the lane is unchanged, no console error but the host's known 422 |
| 6 | **Cost**, BEFORE vs AFTER (table below) | per-tab cost no longer grows with the namespace |
| 7 | The host's cluster check (`.github/workflows/ui-next-pods.yml`) bumped to the pin and extended | HostPodCheck, below |

Row 3, the plugin's client against `kind`, namespace `bulk` (600 Pods), Pod `bulk-0300`:

| Source | Snapshot records | Objects the plugin holds | API requests | Bytes answered |
|---|---:|---:|---|---:|
| scope `namespace` (before) | 600 | 600 | `LIST limit=1` (the probe) + one `WATCH sendInitialEvents=true` | 1,770,281 |
| scope `namespace` + `name` (after) | 1 | 1 | `LIST limit=1&fieldSelector=metadata.name=bulk-0300` + one `WATCH sendInitialEvents=true&fieldSelector=metadata.name=bulk-0300` | 6,108 |

The same test then patches another Pod (nothing arrives at the narrowed source), patches the named Pod (its upsert is the first event) and deletes a throwaway Pod (a `remove` is signalled). client-go's informer reads its initial state as ONE streaming WATCH (`sendInitialEvents`), so the probe is the only LIST.

## Cost, before versus after (600-Pod namespace `bulk`; plain click on a Pod's name in the list; `cost.mjs`)

| What | `checkout` (11 Pods) before → after | `bulk` (600 Pods) before → after |
|---|---|---|
| Click → the Details section drawn (WebKit; Chromium) | 207 ms; 231 ms → 192 ms; 218 ms | **485 ms; 556 ms → 190 ms; 215 ms** |
| Bytes pushed to the page by the source view | 152,072 B (WebKit), 149,343 B (Chromium) → 13,156 B | **4,327,507 B (5 frames) → 8,261 B (3 frames)** |
| Rows the page holds | 11 → 1 | **600 → 1** (8,261 B is one record as the host encodes it) |
| Heap of the page with the detail shown (Chromium; the list tab alone is 12.7 MiB) | 7.7 → 7.6 MiB | **11.3 → 7.5 MiB** |
| A second and a third tab shown in turn on the same namespace (Chromium heap; the list tab alone is 12.7 MiB, three background tabs read nothing) | | 13.3 → 17.9 → 22.3 MiB → 13.3 → 14.2 → 14.7 MiB |
| Bytes per shown tab | | 4.33 MB each → 8.3 KB each |
| Calls of the open | `Catalog`, `ResolveTarget`, `OpenSourceView`, `SyncSourceView`, `CloseSourceView` of the list's view: the same | the same |
| HTTP bytes of those calls (the `Catalog` answer above all) | 100,514 → 119,152 | 100,510 → 119,145 (**+18.6 KB, see D1c-2**) |

Background tabs still read nothing until shown, and a plain click still closes the list's view (D1b). The time to first paint at 600 Pods is the 13-Pod figure, as predicted [now measured].

## Host cluster check (HostPodCheck)

`.github/workflows/ui-next-pods.yml`: `KUBERNETES_PLUGIN_REF` is `1f71e90f2807c3dad59182281830ce19ed58ea1f` (the squash-merge commit of plugin PR #264, which includes the Pod detail page of #263: the page reads its Pod as the name-narrowed watch); the comment of the pin says so; one new no-cluster step runs `scripts/ui-next-pods/detail.test.mjs`. `scripts/ui-next-pods/detail.mjs` (pure: `expectedDetail` from `kubectl get pod -o json`, `compareDetail` for the name, Node, Pod IP(s), Host IP and QoS class) with its test (6 tests, two negative controls: another Pod's values, one changed character); `parity.mjs` `checkDetail` clicks the name link of `checkout/cart-cache-0` in the Pods list, reads the header title and the Details rows and compares them with kubectl, the Pod read before and after each page reading (`DETAIL_MISMATCH` otherwise); `pods-cluster.check.mjs` runs it in the default mode only (the three control modes are unchanged). Run locally on its own kind cluster with the plugin built from the first pin (230f12a9, the interim namespace read): `pin.mjs` ok; the 5 contract test files, 42 tests pass; control-fixture-absent, control-plugin-absent and control-bundle-absent each fail as they must; the default mode is 3 of 3 (the new detail test 567 ms); `pnpm lint` 0 errors, 8 warnings (the same as main). On GitHub's runner the job "Pods cluster check" passed on this PR at that pin (6 min 59 s, and 6 min 16 s after the CodeRabbit fix). The kind cluster has one node, so the Node field cannot tell two Pods apart; the name and the Pod IP do.

## Would the old hosts or the old UI of the plugin's `main` be affected if this backend change were wanted there? (not ported; reported)

- **Old hosts.** No change is needed in a host that has `normalizeQueryScope`, which fills an omitted query dimension with `any`: v0.35.0 (the plugin's `min-ide-version`) has it (`finite_service.go:122,154`), as do v0.35.2 and v0.36.0. Graph demand, observation and relationship binding build targets from `descriptor.QueryDimensions` with `any` for each, which the SDK admits (`TestRelationshipBindingQueryOnlyDimension`). A host older than v0.35.0 was not read; the plugin does not claim to support one.
- **The old UI on `main`.** Not run. By reading: `ui/src/hooks/useKubernetesResources.ts:20` maps EVERY declared query dimension to `any`/`oneOf`, so it sends `{name any}` by itself; the manual scopes (`resourceEditorServices.ts:85,90,107`, Helm dialogs) go to host calls that normalise or to Helm's own types, which keep their dimensions. One visible effect: the host's generic `ui/components/tables/Resources/EnumerableResourceTable.tsx:169` draws one "Filter scope <dimension>" input per declared query dimension, so a table built on it would show an extra `name` filter; whether the plugin's old tables use that component was not checked.
- **The plugin side on `main`** has the same `Source`, `Enumerate` and catalog code, so the patch would apply; it also moves the catalog revision (sources reopen once) and the cursor version (3). Nothing was tried there.

## Backend catalog

Class: BLOCKER = the UI cannot behave properly without it; TANGENTIAL = an independent gain or fix; WIRE = changes the plugin protocol.

| ID | Class | Where | What | Evidence | Interim the UI uses |
|---|---|---|---|---|---|
| D1c-1 (= B-01, D1b-1) | **resolved** by plugin PR #264 | plugin `pkg/plugin/resource/native_catalog.go:126-133`, `native_catalog_assembly.go:38-52`, `clients/clients.go` `AcquireInformer`, `resourcers/base.go` `Source`, `native_read.go` | `name` is a query dimension of every native kind; a source narrowed to one object is one narrowed watch | the two tables above | `usePod.ts` reads by namespace + name |
| D1c-2 | TANGENTIAL | plugin `native_catalog_assembly.go:38-52` (every capability carries its own scope with `name any`) | the `Catalog` answer grew by 18.6 KB (+18.5%) because each capability of each kind now repeats a `name any` constraint, and every shown page asks for the catalog again (D1b-4) | HTTP bytes of the open: 100,510 → 119,145 | none; D1b-4 (the host asks `Catalog` once per page) would remove the repetition |
| D1c-3 | TANGENTIAL | host `backend/pkg/plugin/resource/graph/bindings.go:243-272` (`bindingMatches`, `queryScopeMatches`) | a target restricted to a name (`name oneOf`) never binds a graph node: "restricted dimensions missing from identity remain unproven". The records of a narrowed detail source are therefore not attached to the graph's targets; the Pod page has no relationships yet | the SDK test of the same rule (`TestRelationshipBindingQueryOnlyDimension`) | none needed yet; a detail page that needs relationships reads them through the finite relationship call |
| D1c-4 | TANGENTIAL | plugin `resourcers/base.go` (the probe before each informer) | every source open sends a `LIST limit=1` before the informer's own streaming WATCH; with one narrowed source per Pod that is one extra, tiny request per tab | the request table (row 3) | none |
| D1c-5 | TANGENTIAL | plugin `native_read.go` `nativeEnumerate` | an aggregated API that ignores or rejects `metadata.name` field selectors: Enumerate refuses a wrong answer and the source fails at the probe; not exercised on a real aggregated API | unit tests with a server that ignores the selector | none |
| D1b-2, D1b-3, D1b-4, D1b-5 | unchanged | see D1b.md | | | |

## Not run

- Linux and Windows locally; the native window and WKWebView; an aggregated API; the old UI and old hosts (reported by reading only); a cloud cluster; more than 600 Pods; the D1b stages `--all`, `control`, `secrets`, `nav`, `states`, `retry` on the AFTER host.
- A narrowed source for a kind other than Pods on a real cluster (the catalog, the SDK admission and the source are tested for a namespaced, a cluster-scoped and a CRD kind with fakes and with the SDK; the real-cluster proof is the Pod).

## Not done (exactly what remains)

1. None for the pin: it is at the merge of PR #264. The next bump is deliberate (procedure in the workflow's comment).
2. The Pods list's failure wording and a denied state (D1b "Not done" 2) and the contract's missing pieces (D1a a to g), unchanged.

## The guard of the build outputs in the tree (`scripts/check-tracked-outputs.mjs`, `.test.mjs`)

Three agents lost time to one trap: a local `OMNIVIEW_UI=next` (or any frontend) build deletes the tracked `dist/.gitkeep`, a commit sweeps the deletion in, and the Go build fails on `main.go:92` `//go:embed all:dist` minutes later. The first step of the "Go checks" job (right after `setup-node`, before any cache or toolchain; its checkout fetches 2 commits so that `HEAD^1`, the base of the merge commit, exists) runs `node --test scripts/check-tracked-outputs.test.mjs` and `node scripts/check-tracked-outputs.mjs --base HEAD^1`. It fails in about a second with one line that says what is wrong and how to restore it. On a developer's machine: `node scripts/check-tracked-outputs.mjs --base origin/main` before committing.

| Path | Rule | Why |
|---|---|---|
| `dist/.gitkeep` | must be tracked AND on disk (two messages: a committed deletion, and a deletion a build left in the working tree) | `main.go:92` embeds `all:dist`; `go build` refuses an embed pattern that matches no file; `.gitignore` is `dist` + `!dist/.gitkeep`, so this is the one tracked file of the directory |
| `dist/` (anything else) | must not be tracked | it is the output of the flavour built last (building one flavour replaces the other): a tracked file there is a force-added build output |
| `build/darwin/icons.icns`, `build/windows/icon.ico` | change only in a change that also changes `build/appicon.png` | outputs of `task common:generate:icons` (`build/Taskfile.yml:55-64`, `wails3 generate icons -input appicon.png`), which every desktop build runs again, so a local build rewrites them |
| not protected: `build/darwin/Info.plist`, `Info.dev.plist`, `build/windows/info.json`, `wails.exe.manifest`, `installer/*`, `build/linux/nfpm/nfpm.yaml`, `desktop` | none | `wails3 update build-assets` wrote them once from `build/config.yml` and they were edited by hand since (`Info.plist`: 7 commits, one with `config.yml`): a change is a reviewed edit |

Proof (negative controls, all in `scripts/check-tracked-outputs.test.mjs`, 10 tests, each mistake made for real in a throwaway git repository): a commit that deletes `dist/.gitkeep` fails with "dist/.gitkeep is not in the tree. main.go embeds `all:dist` … restore it with `git checkout -- dist/.gitkeep`"; a deletion left by a build fails with "tracked but missing from the working tree"; a regenerated icon committed without `build/appicon.png` fails and passes with it; an unreadable base is one clear line, not a pass. On this tree: deleting `dist/.gitkeep` gives exit 1 with that line; restored, exit 0. `eslint` on both files is clean. Not run: the job on GitHub's runner (CI runs it).

## Proposals for AGENTS.md (not edited here; the lead decides)

1. "Traps": replace "every frontend build deletes tracked `dist/.gitkeep` (`git checkout -- dist/.gitkeep`). Do not commit either." with "every frontend build deletes tracked `dist/.gitkeep` (`git checkout -- dist/.gitkeep`); `node scripts/check-tracked-outputs.mjs --base origin/main` says so before you commit, and the first step of the "Go checks" job fails a pull request that commits the deletion, a tracked `dist/` build output, or a regenerated `build/darwin/icons.icns` / `build/windows/icon.ico` without `build/appicon.png`. Do not commit any of them."
2. "Commands" (the guards CI runs on the build): add `node --test scripts/check-tracked-outputs.test.mjs && node scripts/check-tracked-outputs.mjs --base origin/main   # the build outputs in the tree (dist/.gitkeep, generated icons); 1 s` after the `react-compiler` / `ui-flavour` line.

## Dev tools

- `~/Notes/omniview/ui-migration/status/D1c-assets/`: the D1b proof driver copied with its paths changed (`d1b-proof.mjs`, `cost.mjs`, `start-host.sh`, `d1b-dom.mjs`, `d1b-oracle.mjs`, fixtures); not in either repository. `BASE`, `KUBECONFIG`, `CONNECTION`, `HOST_WORKTREE`, `HOST_LOG`, `ENGINE` select the host and the cluster.
- The plugin's gated test `TestSourceNarrowedToAnObjectOnARealCluster` (`resourcers/source_name_cluster_test.go`): skipped unless `OMNIVIEW_PROOF_KUBECONFIG` names a cluster; `OMNIVIEW_PROOF_NAMESPACE` (default `bulk`) and `OMNIVIEW_PROOF_POD` select the proof. It counts requests and bytes with a transport wrapper and writes one throwaway Pending Pod.
- The host's `scripts/ui-next-pods/detail.mjs` and `detail.test.mjs` (above), and `scripts/check-tracked-outputs.mjs` with its test (the guard above).

## How to repeat

```sh
HOST=~/Repos/omniviewdev/worktrees/ui-next-d1c-proof-host            # a worktree of origin/main (the fixture and bin/Omniview-server live here)
PLUGIN=~/Repos/omniviewdev/worktrees/kubernetes-ui-next-d1c-name-dimension   # the plugin worktree of PR #264 (the Go proof lives here)
D1C=~/Notes/omniview/ui-migration/status/D1c-assets
kind create cluster --name d1c-name-dimension --kubeconfig /tmp/d1c/kubeconfig --image kindest/node:v1.35.0
export KUBECONFIG=/tmp/d1c/kubeconfig
(cd "$HOST" && kubectl apply -f docs/ui-next/slices/1a-pods-list/fixture.yaml)    # wait for the rollouts, then apply $D1C/rich-pod.yaml
kubectl create namespace bulk && kubectl create -f "$D1C/d1b-fixtures/bulk-600-pending-pods.json"
# one narrowed watch, counted on the wire (plugin worktree)
(cd "$PLUGIN" && OMNIVIEW_PROOF_KUBECONFIG=$KUBECONFIG OMNIVIEW_PROOF_POD=bulk-0300 GOWORK=off GOTOOLCHAIN=local go test ./pkg/plugin/resource/resourcers -run OnARealCluster -v -count=1)
# host: (cd "$HOST" && OMNIVIEW_UI=next task build:server); plugins: (cd <worktree> && hack/package.sh <version> darwin_arm64) at 230f12a (before) and at PR #264 (after)
# a clean HOME with the extracted plugin in .omniview-feature-ui-next/plugins/kubernetes, then, from the host worktree:
(cd "$HOST" && HOME=/tmp/d1c/hosts/after/home OMNIVIEW_CHANNEL=feature-ui-next WAILS_SERVER_PORT=34412 bin/Omniview-server &)
(cd "$D1C" && BASE=http://127.0.0.1:34412 node d1b-proof.mjs values checkout/crashloop checkout/unschedulable && BASE=http://127.0.0.1:34412 node d1b-proof.mjs delete)
(cd "$D1C" && BASE=http://127.0.0.1:34412 HOST_LOG=/tmp/d1c/hosts/after/host.log ENGINE=chromium node cost.mjs)
```

Stop what you start: the hosts by PID, the cluster with `kind delete cluster --name d1c-name-dimension --kubeconfig /tmp/d1c/kubeconfig`.
