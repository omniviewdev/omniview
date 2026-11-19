# Status: D1b (the Pod detail page of the Kubernetes plugin, the first plugin page built on the host's detail page contract)

- Agent: PodDetail2 (D1b, resumed: the first run, PodDetail with its helper ProofRig, died on a rate limit with its work uncommitted in the worktree)
- Goal: the Kubernetes plugin's Pods list has its name cell as the kit `Link` to a Pod detail route; the Pod detail page is a `contributionV1` detail page (tab `{name} · Pod`, header with the kind tile, the state chip, facts and the commands of the mock in its order, reporting to a "not available yet" stub; Overview sections from the mock's Pod overview, each absent when empty; the states loading, not found, denied and error with Retry; the scope lane declared so the page does not move once on load), proved on a real kind cluster against a host built from `origin/main` with `OMNIVIEW_UI=next`.
- Worktrees: plugin `~/Repos/omniviewdev/worktrees/kubernetes-ui-next-d1b-pod-detail`; host (this file) `~/Repos/omniviewdev/worktrees/ui-next-d1b-host`
- Branches: plugin `ui-next/d1b-pod-detail` (PR https://github.com/omniviewdev/omniview-plugin-kubernetes/pull/263, **base `feature/ui-next`**, ready, not merged; one commit, 741b49f); host `ui-next/d1b-status`
- Base: host `origin/main` 7e4bd00f (the D1a merge); plugin `feature/ui-next` c69eb69
- PR: see the pull request of this branch (ready, not merged)

## Log

- 2026-11-17 (the first run): the plugin worktree and the host worktree made; the host vendored at 7e4bd00f (one commit pushed); kind cluster `d1b-pod-detail` with the slice fixture and one extra Pod (`rich`); the proof rig written (the oracle, the DOM reader, the fixtures); the page, its model, its tests and the Pods list's link written in the plugin worktree, **not committed**. The run died on a rate limit.
- 2026-11-18: resumed. Read the nine uncommitted files and ran the plugin's CI commands on them as they stood (typecheck, lint, 485 tests, 28 script tests, build: green; one unused import fixed). One commit per PR: the vendor commit and the work squashed into one and force-pushed to the topic branch (no PR existed yet; `feature/ui-next` untouched). PR #263 opened against `feature/ui-next`; the plugin's "UI checks" green; `@coderabbitai review` asked once (the base is not the default branch).
- 2026-11-18: proof host: `origin/main` 7e4bd00f built with `OMNIVIEW_UI=next task build:server` (the binary of the first run, built from that commit; `dist/index.html` is "Omniview ui-next"), the plugin packaged from the PR branch with `hack/package.sh`, a clean `HOME` per host. The three orphan hosts of the dead run stopped by PID. The proof stages ran in WebKit; the cost of the interim read measured on a 600-Pod namespace.
- 2026-11-18: the states proved on the real host too: denied (an RBAC-limited ServiceAccount), error with a Retry that recovers (a context whose server comes back), loading (a context that never answers). The denied and error texts were the host's fixed sentences ("The operation could not be completed.", "resource operation failed"): the page now says the cause itself for a cause the data layer classified (test first).
- 2026-11-18: CodeRabbit left 3 comments on PR #263, all valid (the token volume by name, credential keys with underscores, a 1m request beside a 1-core limit). Fixed test first in the one commit, answered in their threads. Every proof stage re-run on the final bundle. This file and its PR.

## What was built

All in the plugin, PR #263 (`ui/src/pod/**`, `ui/src/connection.ts`, `ui/src/pods/cells.tsx`, `entry.ts`; the vendored host moves to 7e4bd00f).

- **The page.** `contributionV1.pages.pod` is `{ kind: 'detail', definition, usePage }`: no sidebar entry (it needs an object), definition `{ kind: 'Pod', tile: box/blue, identity: { name: 'name', facets: ['namespace'] }, list: pods, tabs: [Overview] }`. The host titles the tab `{name} · Pod` (qualified by the connection when the route names one), keeps the Pods entry selected and draws the breadcrumb.
- **The link.** The Pods list's name cell is the kit `Link` to `{ page: 'pod', params: { namespace, name } }` (a row with no namespace has no identity: plain text). The host's links do the rest: click or Enter opens in this tab, Command or Control or middle click in a background tab.
- **The data (INTERIM, one file, `ui/src/pod/data/usePod.ts`).** The curated entry has no live single-object read (`useResource` is a one-shot `Get` with no deletion signal and is not in `@omniviewdev/runtime/ui/v1`), so the page reads the Pod's **namespace as a live collection** through `useResources` (`collection: true`, `live` when the Pod type advertises `sourceUpdates`) and picks the record by its address. A Pod absent from the complete snapshot is not found; one that leaves it while the page is open turns the page into the not-found state and the tab stays. The decoder (`object.ts`) keeps each field only with the type the API gives it and decodes a record once. The measured cost is below; the proper fix is step D1c.
- **The header.** Kind tile, the state chip in the Pods list's roles (kubectl's STATUS word), facts namespace · node · age, Logs, Shell, Delete and the overflow menu (Forward port…, Debug container…, Events, Copy name) in the mock's `LAYOUT.Pod` order, each reporting to one stub (`notAvailableYet`) and drawn with the kit's pattern for a command that cannot be used (a reason, written once in the identity line: "Logs, Shell and Delete are not available yet"); the page's own Refresh.
- **The Overview.** The one-line summary (`2/2 ready · 0 restarts`; no restarts item when no container has reported); Details (kv, 2 columns: Node, Pod IP(s), Host IP, QoS class, Service account, Controller as text, Created in UTC, Started only when it says more than the age); Containers, Init containers, Debug containers (name, image cut in the middle with its name and tag whole, ports and resources columns only when some row has them, state with its role and the platform's word, ready, restarts with the last termination reason); Volumes (type, source, where mounted; the token volume the service account generates is not listed); Conditions; Labels (10 shown) and Annotations (6 shown) as tags in the aside, the cluster's own keys last. **A credential-like annotation (its key says secret, token, password, credential or a key, with a hyphen, underscore, dot or nothing between the words, and kubectl's last-applied-configuration) never has its value in the data: the key shows with a mask.** A section with nothing to say is not drawn.
- **The states**: loading (the host's skeleton, a "Loading" chip), not found (the message names the namespace and says it may have been deleted), denied, and a failure with a Retry (kept beside the Pod, in the header's slot, when it came after it). A cause the data layer classified is said in the page's own words; the runtime's text is used only for a failure it could not classify (see B-02 below).
- **The scope lane** is declared from the first render (`connection.ts`, shared by the list and the page): the face is always there and its text is a word ("Loading…", "None") while the connection is not known, so the host's reserved lane is never given back.

## Results

Surface: the browser server mode of the host (**not** the native window), WebKit 27.2 for everything and Chromium 156 for the values and navigation stages, macOS arm64, 2026-11-18. Host: `origin/main` 7e4bd00f built with `OMNIVIEW_UI=next task build:server` (`dist/index.html` is "Omniview ui-next"), `OMNIVIEW_CHANNEL=feature-ui-next`, a clean `HOME`. Cluster: kind, node v1.35.0, the slice fixture plus `rich`. Plugin: PR #263 at 741b49f packaged with its own `hack/package.sh` (`entry.js` 44,046 B, sha256 `a73b1aa6…`). The whole log is `D1b-assets/d1b-proof-run.log`.

| # | Check | Result |
|---|---|---|
| 0 | The plugin's CI commands (`.github/workflows/pr.yml`): `pnpm install --frozen-lockfile`, `pnpm run lint`, `pnpm test`, `pnpm run test:scripts`, `pnpm run build` | lint 0 problems; **494 tests** in 18 files; 28 script tests; the build and the loader's bundle check clean (imports react, the kit and the curated entry only; exports `contributionV1`). PR check "UI checks" green on the first push; on the final commit see the PR |
| 1 | Click a Pod's name in the list: a detail tab with the right title | PASS for every Pod of the cluster (31 openings): the name is a link (`#/kubernetes/pod?namespace=checkout&name=crashloop`), the tab reads `{name} · Pod`, the page opens in the same tab (smart open), the lane reads `Connection: kind-d1b-pod-detail`, `Namespaces: checkout` |
| 2 | **Values equal `kubectl`**: a healthy (`cart-api-86bf766589-ct9b5`), a crash-looping (`crashloop`), a pending (`unschedulable`), an image that cannot be pulled (`bad-image`), one with every section (`rich`), then every Pod of the cluster (26, among them a Job's, a DaemonSet's, a StatefulSet's and the four static control-plane Pods) | **0 mismatches in 31 comparisons** against the oracle (`kubectl get pod -o json`: the header, the chip, the facts, the breadcrumb, the commands in order, the summary, the sections in order, every cell, every tag) and against `kubectl describe pod` (Node and Host IP, IPs, QoS, service account, controller, every container's image, state, ready, ports and restart count, the conditions, the labels, the annotations). A state kubectl itself changes between reads (the crash-looping container is `Error` and `CrashLoopBackOff` a few seconds apart) may read either way |
| 2b | Negative control of that comparison | 6 of 6 fail as they must: the page of `rich` against the object of `crashloop` reports 16 mismatches; one character appended to the Node, an image, a restart count and a label value each reports the field, in the oracle and in the describe check |
| 3 | `kubectl delete pod` while the page is open | PASS both ways. Graceful: `Running`, `Terminating`, a moment of `Error` (the container's exit), then after 30.7 s "**d1b-victim was not found** · Pod d1b-victim doesn't exist in namespace checkout. It may have been deleted."; forced: not found after 187 ms. **The tab is kept** with its title, the lane is unchanged, no console error |
| 4 | Command-click | PASS: a second tab `cart-cache-0 · Pod` opens in the background, the list stays active and visible; a middle click opens a third; a background tab reads nothing until it is shown, and then holds the Pod it names, loaded |
| 5 | Back to the list keeps its scroll | PASS: left at 355 px, back at 355 px; a plain click had opened the Pod in the same tab, Back returns to the list tab with the other Pod tabs still beside it |
| 6 | The page does not move once on load | PASS: the page region's top is 80 px and its height 783 px in **every** sample (134 samples of the list's load, 96 of a detail's), while the lane's faces go `[]` → `Connection: Loading…` → the connection's name. The **baseline plugin** (`feature/ui-next` c69eb69, same host) moves 80 → 40 px and 783 → 823 px: the 40 px of the lane given back |
| 7 | Credential-like annotations | PASS: on `rich` the values `do-not-show-this-token`, `secret/data/checkout/rich` and `not-a-real-password` are in no text or attribute of the page (after hovering every tag); `example.io/api-token`, `vault.example.io/secret-path` and the last-applied configuration show the mask; the two plain annotations show their values |
| 8 | The states on the real host (`states.mjs`, `retry.mjs`; a second host with a limited user, a context that is not there and one that never answers) | **denied**: "Access to crashloop is denied · You do not have access to read this Pod." for a ServiceAccount that may list Pods in `batch` only (the same account reads `batch/nightly-report-4c6q7`); **error with Retry**: "Couldn't load cart-cache-0 · The cluster did not answer." with Retry, Retry while it is still down fails again, Retry once `kubectl proxy` serves the context loads the Pod after 500 ms; **loading**: the skeleton and a "Loading" chip for 10 s on a cluster that never answers, then the error |
| 9 | Chromium | PASS: the five Pods and the navigation stage (17 checks) as in WebKit |
| 10 | Console | no page error and no console error but the host's known 422 of the activity session in server mode (B-08) in any stage |
| 11 | Screenshots, WebKit, theme void, 1440x900 and 1280x800 | 22 files in `~/Notes/omniview/ui-migration/status/D1b-assets/`: `D1b-list-linked-…`, `D1b-detail-healthy-…`, `-crashloop-…`, `-pending-…`, `-rich-…`, `D1b-tabs-background-…`, `D1b-state-not-found-…`, `-loading-…`, `-denied-…`, `-error-…`, `-error-recovered-…` |

## Cost of the interim read (measured on a 600-Pod namespace)

kind v1.35 cluster, one node. Fixture: namespace `checkout` (13 Pods) and a throwaway namespace `bulk` of 600 unschedulable Pods (`d1b-fixtures/bulk-600-pending-pods.json`, 7.9 KB per Pod as the host encodes it), 626 Pods in all; deleted after the measurement. `cost.mjs` (WebKit for the times, Chromium for the heap after two forced GCs, the runtime's calls counted from the page, the host's "source stream" log lines counted).

| What | `checkout` (13 Pods) | `bulk` (600 Pods) |
|---|---|---|
| Plain click on a name → the Details section drawn (WebKit; Chromium) | 171 ms; 189 ms | **489 ms; 515 ms** |
| Bytes pushed to the page by the source view | 149 KB | **4.71 MB** (5 frames) |
| Heap of the page with the detail shown (Chromium; the list's tab was 13.1 MiB) | 7.7 MiB | 11.8 MiB (the namespace's 600 records are about +4 MiB) |
| Calls of the open | `Catalog` (99 KB), `ResolveTarget`, `OpenSourceView`, `SyncSourceView`, and `CloseSourceView` of the list's view | the same |

- **It does not share the list tab's data.** The list asks for every namespace; the detail asks for one, so it is another request and another source view (the host's log shows one more "source stream received first frame" per shown tab). The plugin does share the *watch*: it leases one informer per (namespace, resource) (`pkg/plugin/resource/clients/clients.go:156`, a lease count), so the API server sees one watch per namespace however many tabs read it; the cost is the snapshot the host sends each source session, and the records the page holds.
- **Two tabs on one namespace do not share either**: the second `bulk` tab pushed the same 4.71 MB again and held its own copy (+4.7 MiB in Chromium; 13.1 → 18.7 → 23.4 MiB with the list's data kept in the cache).
- **A background tab reads nothing** until it is shown: three Command-clicks on Pods made no call and no bytes in the 2.5 s after each. Showing a tab opens its view and closes the one of the tab that was shown (one source view open at a time: every activation made as many `CloseSourceView` as `OpenSourceView` calls), so **going back to the Pods list re-reads it** (`Enumerate` 2.1 MB plus 5.1 MB of source for 626 Pods): a tab switch costs the rows of the page you go to. Heap never came down across the sequence (24.1 MiB at the end): the data of the hidden tabs stays in the cache.
- Verdict: correct (live, not found on delete, proved above) and cheap for a namespace of tens of Pods; O(namespace) in time, bytes and memory per shown tab for a large one. D1c makes it O(1).

## CodeRabbit (PR #263): 3 inline comments, 3 valid, 3 fixed, 0 not applicable

| # | File | Verdict | What |
|---|---|---|---|
| 1 | `pod/overview/model.ts` (token volume) | fixed (test first) | the filter matched the name `kube-api-access-…` only, so a ConfigMap a person called `kube-api-access-settings` vanished with its mounts; the generated volume is now the projected volume with a `serviceAccountToken` source |
| 2 | `pod/overview/model.ts` (protected annotations, Major) | fixed (test first) | `api_key`, `private_key`, `access_key` were not matched (only a hyphen or nothing): the words may be separated by `-`, `_`, `.` or nothing; 12 credential keys masked and 5 ordinary ones (`author`, `monkey-business`, `keyboard`, …) kept visible, in the model and in the rendered tags |
| 3 | `pod/overview/quantity.ts` | fixed (test first) | `1m` beside a limit of `1` drew "0–1 cores"; a positive request that would round to zero cores now says the range in millicores (`1–1,000 mCPU`). The mock's own formula has the same defect: this is where the plugin's page differs from the mock, on purpose |

## Decisions I took, for the lead to confirm

1. **Facts are namespace · node · age** (the brief's list). The mock's K59 identity line is Kind · Namespace · Age with the node in Details, and D1a's spec said kind, namespace, age, uid. The tab title and the tile carry the kind; changing the facts is one function (`factsOf` in `ui/src/pod/overview/view.tsx`) and its oracle line.
2. **The runtime's words are not shown for a classified cause.** The host's text for a denial or a sign-in is a fixed sentence by design (`backend/pkg/apperror/resource.go:43,169-171`), and the connection's raw detail is B-07: the page says "You do not have access to read this Pod.", "The cluster did not answer.", "The connection needs you to sign in." itself, and shows the runtime's text only for an unclassified failure. **The Pods list still shows the runtime's text** (and has no denied state in its contract: a cluster-wide denial reads "Couldn't load Pods · The operation could not be completed."): a one-line change in `ui/src/pods/source.ts`, left out of this step.
3. **`min-ide-version` was not changed** (D1a asked to set it to the first host build with the detail page): a feature host judges compatibility against 0.35.2 (`docs/ui-next/channels.md` section 4), so no value can express it. An older feature host refuses the whole bundle by name at admission (the Pods list too). See the catalog.
4. **A protected annotation shows its key and a mask, no Reveal**: the contract has no `protected` tag (D1a, "what the contract still lacks", b). The value is not in the data, so nothing could reveal it.
5. **The Controller is text** ("ReplicaSet cart-api-86bf766589"): there is no page of that kind in this plugin yet.
6. **Not built, by the step's scope**: Environment from, Health checks, Used by, Recent warnings, Scheduling, Usage, the Events, Metrics and YAML tabs, the Delete confirmation, the in-page tab in the route (D1a's list a to g).

## Backend catalog

Class: BLOCKER = the UI cannot behave properly without it; TANGENTIAL = an independent gain or fix; WIRE = changes the plugin protocol.

| ID | Class | Where | What | Evidence | Interim the UI uses |
|---|---|---|---|---|---|
| D1b-1 (= B-01, **step D1c**) | BLOCKER (the lead's class; the measured cost is real only for large namespaces) | plugin `pkg/plugin/resource/native_catalog.go:126-131` (the one `namespace` dimension; `:111-115` at the pin R1 read) and `:148-159`; `native_catalog_assembly.go:44-55`; `resourcers/base.go:501,553,614` | a `name` query dimension with `sourceUpdates` on the native types: see "Step D1c" | table above | `ui/src/pod/data/usePod.ts`: the namespace as a live collection |
| D1b-2 | TANGENTIAL | host `backend/pkg/plugin/registry/registry.go:237,447-461`, `internal/version/version.go:10,31-40`; plugin `.github/workflows/feature-channel.yaml:136` | no way for a plugin build to require a host that has the detail page: a feature host sends `ide_version=0.35.2`, so `min-ide-version` cannot name a later build; an older feature host loads the new bundle and **refuses all of it** by name (the Pods list too) | `channels.md` section 4; D1a step 1 | none: the plugin and host feature builds move together; `min-ide-version` left at 0.35.0 |
| D1b-3 | TANGENTIAL (an observation; cause not found) | host `backend/pkg/invocation/invocation.go:149-157,190-195`, `internal/mcprelay/authority.go:364-367` | after about 60 browser sessions in 20 minutes one server-mode host began answering `ListConnections` (`packages/omniviewdev-runtime/src/bindings/.../resource/servicewrapper.ts:179`) with 403 `omniview:resource/forbidden` "The operation is not permitted." to every new session, so every page said "No connections", until the host was restarted. The plugin was running, the log has no line for it, the other hosts of the same build were fine | the host's activity feed holds one "Access denied" message per attempt from 23:30:32 on | restart the host; the proof's later stages were run on a restarted host. [INFERENCE: a server-mode session limit, the family of B-08] |
| D1b-4 | TANGENTIAL | host `backend/pkg/plugin/resource/finite_service.go:96-107` (`Catalog`) | the catalog answer is 99 KB and each shown page asks for it again (every list mount and every shown detail tab made one `Catalog` call) | `cost.mjs` calls: one `Catalog` per activation, 99,085 B | none |
| D1b-5 (evidence for B-02, B-07) | BLOCKER (as B-02) | host `backend/pkg/apperror/resource.go:43,169-171`; plugin `pkg/plugin/resource/native_catalog_*` errors | a forbidden read arrives as "Access denied / The operation is not permitted." or "The operation could not be completed."; an unreachable cluster as "resource operation failed" | screenshots `D1b-state-denied`, `D1b-state-error` (the first run's words, before the page said the cause itself) | the Pod page words the cause itself (above); the Pods list does not |

### Step D1c: the proper fix for the Pod page's read (and for every detail page of the plugin)

**What.** Declare `name` as a *query* dimension of every native type, with `sourceUpdates` scoped to it, so a detail page opens a live source view of **one object**: `scope [{ namespace oneOf [ns] }, { name oneOf [name] }]`. The host needs nothing (R1.md: `OpenSourceView` admits it as an ordinary `ReadTarget`), and `ResolveTarget` fills an omitted dimension with `any` (`backend/pkg/plugin/resource/finite_service.go:109-170`), so every existing caller (the Pods list asks for `namespace` only) keeps working.

**Files (plugin repo).**
1. `pkg/plugin/resource/native_catalog.go:126-147`: add `Dimension{Name: "name", AllowEmpty: true}` to `QueryDimensions` only (`:148-159` hands the same slice to both today; split it, so the object's *identity* stays namespace + id), and a `{name, any}` constraint to the `scope` every capability carries; cluster-scoped kinds get the name dimension too.
2. `pkg/plugin/resource/native_catalog_assembly.go:44-55`: the `sourceUpdates` capability's scope (`watchScope`, from `connection_provider.go:448`) must carry the `name` constraint (the SDK refuses a scope that misses a declared dimension, `validation.go:489-529`).
3. `pkg/plugin/resource/resourcers/base.go:501-620` (`Source`, the generic base of every kind): read the `name` constraint next to `watchNamespaces(request.Target.Scope)` (`:553`) and filter the **initial snapshot** (the `initial` map, `:566-583`) and the **live handler** (`makeSourceHandler`) by `metadata.name`. Keep one shared informer per (namespace, resource) (`clients.go:156` leases are counted): an informer per name would give up the sharing the list and the detail tabs have today.
4. `native_read.go` (`Enumerate` and native queries) must accept the constraint and apply it (the SDK leaves "selection-only filtering and its coverage claim" to the native source: `plugin-sdk@v0.20.0 pkg/resource/v2/controller_admission.go:276-286`).
5. Tests: the catalog (`native_catalog_test.go`: dimensions and scopes for a namespaced and a cluster-scoped kind), `Source` with a `name` constraint (snapshot holds one record; an update of another object emits nothing; the object's deletion emits a `remove`), and a catalog digest test (the revision changes once).

**SDK and wire.** None. `queryDimensions` and `ScopeConstraint` are in the descriptor at SDK v0.20.0; no field, no RPC, no SDK release and no cohort bump (B-13). The catalog `revision` digest changes (`native_catalog_assembly.go:81-82`), and `source_contract.go:14-15,68-69` compares the declared dimensions of an open source with the current catalog, so sources opened before a plugin upgrade re-open once (they restart with the plugin anyway).

**Generic?** For every kind built in `native_catalog.go`'s loop (core, apps, every CRD; namespaced and cluster-scoped), because `Source` is `KubernetesResourcerBase[T]`'s. Not for the types registered beside it (`helm:releases`, `auditResourceType()`, `editorQueryResourceType()`), and other plugins declare their own dimensions (the contract already admits any).

**In the UI afterwards.** `usePod.ts` becomes a one-record source view with the same not-found rule (absent after the snapshot; a `remove` while open), the same tests at its seam, and nothing else changes. Expected gain on the measured 600-Pod namespace: 4.71 MB and about 4 MiB per shown tab become one record (about 8 KB); the time to the first draw approaches the 13-Pod figure (171 ms) [INFERENCE: not measured, D1c does not exist].

## Not run

- Linux and Windows; the native window and WKWebView (the proof is the browser server mode, WebKit 27.2 and Chromium 156 on macOS arm64); a cloud cluster; a cluster with hundreds of namespaces; a Pod with an ephemeral (debug) container, an NFS or CSI volume or a native sidecar on the real cluster (those are covered by the golden unit tests on objects from the same API server version, not by the page).
- The Delete, Logs and Shell actions (they are stubs by the step's scope), the overflow menu's items, the Events, Metrics and YAML tabs.
- The host's own CI commands (`pnpm test`, probes, seam check): this PR changes one markdown file; the host at `origin/main` 7e4bd00f is what the proof ran against.

## Not done (exactly what remains)

1. **Step D1c** in the plugin backend (above), then swap `usePod.ts` to the one-record view.
2. The Pods list's failure wording (`ui/src/pods/source.ts`: the same cause sentences as the Pod page, and a denied state in the list contract).
3. When the plugin's PR #263 merges: move the pin in `.github/workflows/ui-next-pods.yml` if the host's cluster check should cover the detail (it was not moved).
4. The contract's missing pieces D1a listed (a, b, c, d, e, f, g), in the order the next Pod sections hit them.

## Dev tools

All in `~/Notes/omniview/ui-migration/status/D1b-assets/` (not in either repository; the screenshots are beside them).

- `d1b-proof.mjs`: the proof driver (Playwright from the host worktree). `values [pod…|--all]` opens each Pod from the list and compares the page with `kubectl get pod -o json` (the oracle) and `kubectl describe pod`; `control` is the comparison's negative control (another Pod's object; one character changed); `secrets`; `nav` (Command-click, middle click, Back keeps the scroll); `delete` (graceful and forced); `lane` (the page region while the list and a detail load); `shots <dir>` (every screenshot at both viewports). Env: `BASE`, `KUBECONFIG`, `CONNECTION`, `ENGINE`, `WIDTH`, `HEIGHT`, `STATES`.
- `d1b-oracle.mjs` (+ `d1b-oracle.test.mjs`, 53 tests, `node --test`): what the page must show for a Pod, derived from its JSON and nothing else, an independent port of the mock's formats; `parseDescribe`/`diffDescribe`. `d1b-dom.mjs`: what the page shows, read the way a person reads it, and the samplers (frame, stopwatch, states). `d1b-fixtures/`: five Pods' JSON, six describes, the 600-Pod `bulk` list.
- `rich-pod.yaml` (one extra Pod with every section; applied beside the slice fixture), `start-host.sh <name> <port> [package]` (a clean `HOME`, the plugin extracted into the channel's plugin directory, `WAILS_SERVER_PORT`, `OMNIVIEW_CHANNEL=feature-ui-next`), `run-all.sh <log>` (every stage into one log), `cost.mjs`, `states.mjs` and `retry.mjs` (deep links to the states; Retry that recovers), `liststate.mjs`.
- The states kubeconfig (recipe, not a file): the admin context, `kind-d1b-limited` (a ServiceAccount token with a Role that gets, lists and watches Pods in `batch` only), `kind-d1b-flaky` (server `http://127.0.0.1:8765`: nothing listens until `kubectl proxy --port=8765` runs) and `kind-d1b-hang` (server `https://10.255.255.1:6443`, which never answers).

## How to repeat

```sh
# cluster and fixture (the host's slice fixture, then the extra Pod)
kind create cluster --name d1b-pod-detail --kubeconfig /tmp/d1b/kubeconfig --image kindest/node:v1.35.0
KUBECONFIG=/tmp/d1b/kubeconfig kubectl apply -f docs/ui-next/slices/1a-pods-list/fixture.yaml   # wait for the rollouts
KUBECONFIG=/tmp/d1b/kubeconfig kubectl apply -f ~/Notes/omniview/ui-migration/status/D1b-assets/rich-pod.yaml
# host: origin/main 7e4bd00f
OMNIVIEW_UI=next task build:server                                  # in a worktree of 7e4bd00f; then `git checkout -- dist/.gitkeep`
# plugin: PR #263 at 741b49f
(cd <plugin worktree> && hack/package.sh 0.21.3-feature-ui-next.local.4 darwin_arm64)
D1B=~/Notes/omniview/ui-migration/status/D1b-assets
$D1B/start-host.sh main 34411                                        # edit the host path in the script if the worktree differs
cd $D1B && node d1b-proof.mjs values && node d1b-proof.mjs nav && node d1b-proof.mjs delete   # and control, secrets, lane, values --all, shots <dir>
```

The final bundle's `ui/dist/assets/entry.js` has sha256 `a73b1aa61a5962e57fdf680e0a091123878f7a32338fb7bc0b456d3bc27f8c8d`. Stop what you start: the three hosts by PID, the cluster with `kind delete cluster --name d1b-pod-detail`.
