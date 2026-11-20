# Status: SEC1 (the Kubernetes plugin sends no Secret value: projection on every read; Reveal designed, not built)

- Agent: SecretProjection
- Goal: the plugin backend sent every Secret's `data` values to the renderer on list and watch reads (finding of K2b-1, Backend catalog, `native_read.go:471-507`), though a list needs metadata, type and key names. Establish every path by which a Secret's bytes can reach the frontend, project Secrets server-side on all of them (metadata, `type`, `immutable`, each key's NAME and SIZE, never a value), design the one deliberate read for ONE key (Reveal), prove it on a real kind cluster, and look (read-only) at what else is bulk-sent.
- Worktrees: plugin `~/Repos/omniviewdev/worktrees/kubernetes-ui-next-sec1-secret-projection`; the plugin at the base commit `~/Repos/omniviewdev/worktrees/kubernetes-ui-next-sec1-base` (detached 76e65da, the control build); host built from `origin/main` for the proof `~/Repos/omniviewdev/worktrees/ui-next-sec1-host-build` (detached be06aa2d); host (this file and the tools beside it) `~/Repos/omniviewdev/worktrees/ui-next-sec1-status`
- Branches: plugin `ui-next/sec1-secret-projection`, PR https://github.com/omniviewdev/omniview-plugin-kubernetes/pull/268 (**base `feature/ui-next`**, one commit); host `ui-next/sec1-status` (this PR)
- Base: plugin `feature/ui-next` 76e65da (the K2b-1 merge); host `origin/main` be06aa2d
- The host's code, the kit and `ui/v1` are not touched. Line numbers below are those of the base commits.

## Log

- 2026-11-19: read AGENTS.md (rules 16 and 22) and K2b-1 (host PR #552) for the finding; read every path in "Facts" in both repositories and the old UI on the plugin's `main`.
- 2026-11-19: tests first, seen red at 76e65da: 7 registration-level tests fail with 122 hits of planted values in the bytes the plugin sends; the unit tests of the projection did not compile (`ProjectObject` did not exist) and, with a pass-through stub, 17 of them failed. Branch pushed with the red commit.
- 2026-11-19: `resourcers.ProjectObject` applied in `nativeRecord` and `watchRecord`; Go and UI suites green; plugin PR #268 opened; `@coderabbitai review` asked once.
- 2026-11-19: own kind cluster (kind, node v1.35.0, private kubeconfig, deleted at the end): the focused proof, a Go probe against the real API server, and K2b-1's own proof on the fixed commit; then `redo.sh` as published.

## Result

Surface: the browser server mode of the host (**not** the native window), WebKit 27.2 and Chromium 156, macOS arm64, real kind v1.35.0 cluster. Host `origin/main` be06aa2d built with `OMNIVIEW_UI=next task build:server`; plugin built by `hack/package.sh` at the commit of PR #268 (`entry.js` 70,535 B, sha256 `6b54765a…f28252`: byte for byte the K2b-1 bundle, because the UI change is comments, tests and a README) and, as the control, at 76e65da.

| # | Check | Result |
|---|---|---|
| 1 | Tests first: the new Go tests at 76e65da | red: 7 tests, 122 hits of planted values in the JSON and protobuf of pages, records and frames |
| 2 | `go build ./...`, `go vet`, `go test ./pkg/... -count=1` at the fix | all packages ok (resource 8.9 s, resourcers 7.5 s) |
| 3 | Plugin UI CI sequence: `pnpm install --frozen-lockfile`, `lint`, `test`, `test:scripts`, `build` | green: 46 files, 1,377 tests; 28 script tests; bundle unchanged |
| 4 | **The Secrets page equals `kubectl get secrets -A`** (14 rows: name, TYPE, DATA = Keys, age, footer), WebKit and Chromium; and follows a key added to a Secret, a Secret made and a Secret deleted with no reload, equal to kubectl after each | PASS in both engines, for the fixed plugin and for the control |
| 5 | **No value in anything the page receives**: every value of every Secret of the cluster (clear, base64, JSON text; the first 64 bytes of a long one) and each planted token (clear and base64 at its three alignments), 86 forms in Chromium and 94 in WebKit, looked for in each frame of the event socket, each response of the call endpoint, the whole JS heap of the page (heap snapshot, Chromium), its storage, the host's output (9,247 B) and the 14 files the host and the plugin wrote | **zero occurrences**, fixed plugin, both engines |
| 6 | The same scan on the plugin before the fix (the control: a scan that finds nothing proves nothing) | found: 38 forms in the frames, 36 in the responses, 35 to 36 in the heap (two runs). The host's output and files held none even then: the plugin's logs carry no value |
| 7 | Bytes the page received over the whole run, for the Secrets list (Chromium; a 512 KiB Secret is on the cluster) | 1,683,787 before (752,951 on the socket, 930,836 in call responses), 278,882 after (the published script's run: 1,683,789 and 278,882) |
| 8 | A Go probe of the plugin's own registration, built from the real cluster's discovery, asked every operation: list in both representations, label query, read narrowed to one name, Get of each of the 14 Secrets, create and delete, the live source (snapshot, add, modify, remove) and the source narrowed to one name | no value anywhere; every key's name and size equal the cluster's. With the projection switched off it fails on the first frame |
| 9 | K2b-1's own proof (13 lists against kubectl in both engines, a live change in each group, the sidebar, no Secret value on a page) on the fixed commit | 217 of 217 PASS; host check 3 of 3 |
| 10 | `redo.sh`, run as published, on a fresh cluster | PASS, 42 of 42 checks, at the plugin commit of PR #268 with the control built from 76e65da, a fresh cluster deleted at the end; the same numbers as the first run (the heap control found 36 forms instead of 35) |

Controls: the scan is run on buffers that hold a value (in each form) and on a clean one before any page; the base plugin is the second control (row 6); the Go probe is run once with the projection off.

## Facts: every path by which a Secret's bytes reached the frontend

"Before" is the base commit. A value is `data` (base64 text), `stringData` (never returned by a real API server; it appears when an object is echoed, as the create result of a fake) and the annotation `kubectl.kubernetes.io/last-applied-configuration`, which `kubectl apply` fills with the manifest: a Secret made from a manifest with `stringData` holds its values **in the clear** there (seen on the proof cluster).

| # | Path | Where (before) | What reached the frontend | Now |
|---|---|---|---|---|
| 1 | Collection read: an explicit page (the first set of 256, `Enumerate`, the label query) | plugin `native_read.go:115` `nativeEnumerate`, `:264` → `nativeRecord` `:471-507` (the whole `object.Object`; only `metadata.managedFields` dropped, and only in the model representation) → `ValueFromNative` `:496`; host `finite_operations.go:218,277,339`; renderer `resource/v2/client.ts:91`, `hooks/resource/useResources.ts:327,353` (query cache) | every value, and the manifest annotation | closed: `nativeRecord` projects |
| 2 | Live updates: the source view (snapshot, add, modify) | plugin `resourcers/base.go:549` `Source` → `:721` → `watchRecord` `:169-190` (the whole `u.Object`; coverage `complete` for any representation); host `source_apply.go:413` keeps each member's whole body in the host's memory for the life of the source; `resource/v2/sourceView.ts:239` (`Events.On`), `useResources.ts:306` (`setQueryData`) and the lingering views (`:50,121`; `VIEW_LINGER_MS = 60_000`, `MAX_LINGERING_VIEWS = 4`: `sourceViewLimits.ts:7,10`) | the same, in the page's memory for as long as the view lives and 60 s after the last observer leaves | closed: `watchRecord` projects, so the host holds sizes too |
| 3 | The name-narrowed single-object source of PR #264 (the Pod page's way: scope `{namespace, name}`) | `base.go:269` `watchSelectionOf`, `:678` the narrowed informer; the finite twin: `native_read.go:261-264` (a name slot) | the same two record builders, so the same values | closed by the same two changes (tests for both) |
| 4 | Any Get | `native_read.go:33-80` (`:65`); host `finite_operations.go:130`; `client.ts:84`; `useResource.ts:49` (a query cache entry). `ui/v1` exports none of it (`ui/v1.ts:19-103`); the old UI does | the whole object | closed: `nativeRecord` projects |
| 5 | The results of a mutation | `native_mutation.go:53` (delete returns the record of the object it read first), `:96` (create), `:114` (update); host `finite_operations.go:355` hands the raw record back | the whole object as the server returned it | closed: `nativeRecord` projects |
| 6 | The editor path | the old UI loads a Secret to edit with `ResolveReference` + `Get` of `kubernetes.object.v1/v1` (old UI `resourceEditorServices.ts:170-176`) = row 4. Actions (`editor_actions.go:22,97`: review, token, CSR, eviction, scale, metrics, cert-manager, Crossplane) return no Secret body. The references lookup reads Secrets as a Table / `PartialObjectMetadata`, never JSON (`editor_references.go:34-36`, a test pins it): name, namespace, uid, resourceVersion, type | nothing beyond row 4 | already closed (references); row 4 closed |
| 7 | The graph and observation path | host `graph_observation.go` sends edges, chains, trees and subgraphs (identities); `observed_resource.go:18,344` returns only schema-approved scalar paths of a retained source body to host-internal callers (metrics), never a body; relationships point TO Secrets by name (`resourcers/relationships.go:82-243`), none starts from one | no value to the frontend; the host's source session did hold the whole body (row 2) | closed with row 2 |
| 8 | The plugin's own logs and spans | `native_crud_telemetry.go:11-78` records identifiers and counts, "never bodies"; host `action_diagnostics.go:51` ids and outcome | none | nothing to close: proved (row 6 of Result: the unfixed plugin's logs and files hold no value) |
| 9 | The plugin process: the informer cache | `clients/clients.go:216` (`NewFilteredDynamicSharedInformerFactory`): the shared cache holds each whole Secret for as long as a source lives | stays in the plugin's process (a trusted process, not the frontend) | **not closed**; Backend catalog |

**What the old UI on the plugin's `main` relies on.** It reads values from the list/watch record itself. `SecretSidebar.tsx` takes `ctx.data`, "the table's cached row body, shared by every table and view of the record", decodes `secret.data` with `atob`, shows and hides each value, copies it (`atob(value)`) and edits it; `Secret/Table.tsx` draws the keys of `Object.keys(row.data)` and `row.stringData`; the editor loads the raw object by `Get` (row 6) and `SecretForm.tsx` reveals existing values from that draft and saves the draft back. `main` has the same `nativeRecord`. **If this were ported to `main`** [INFERENCE: the old UI was not run]: the Keys chips still work (the keys stay); the drawer finds `{ size }` where it decodes a base64 string and fails; the editor loads a projected object, so a user sees sizes where values were, and a save is refused by the API server (a `data` entry must be a string), not written. It is why this stays on `feature/ui-next`, whose UI is the new one only.

## What the record is now

```
{ apiVersion, kind, metadata (without managedFields on the model representation, and without the last-applied annotation),
  type, immutable (when set),
  data:       { <key>: { size } },      // size in bytes of the decoded value; 0 for an empty or null one
  stringData: { <key>: { size } } }     // bytes of the UTF-8 text; never sent by a real server, projected when present
```

- **Where**: `pkg/plugin/resource/resourcers/projection.go` (`ProjectObject`, `ProjectionLimits`), called by `nativeRecord` and `watchRecord`, which now take the GVR so that a record of a Secret cannot be made without it. A Secret is the core API's `secrets` in any version; a kind of another group called `secrets` is sent whole (a test).
- **An allowlist**: apiVersion, kind, metadata, type, immutable, data, stringData. A member of a Secret that is none of them (a field a later API version adds) is not sent: what is not known to hold no value is left out.
- **Both representations**, and every operation: the host asks for `kubernetes.object.v1/v1` when the UI names none (`ResolveTarget` takes the catalog's default), so the raw representation is the one the new UI reads; a separate "model" representation could not have been the fix. The record's and the page's coverage say it: `partial`, paths `/data`, `/stringData`, `/metadata/annotations/kubectl.kubernetes.io~1last-applied-configuration` (and `/metadata/managedFields` on the model representation), with a reason. Nothing in the host or the UI reads record coverage today (checked), so no behaviour moves.
- **The shape cannot be written back by mistake**: an object whose `data` entries are `{ size }` is refused by the API server on update (400), where a record that merely lacked `data` would have *wiped* the Secret on a PUT. The names and sizes cost a few hundred bytes a Secret and make the record fit the wire budget whatever a Secret holds (the record a 1 MiB Secret needs is no longer cut by `RESOURCE_LIMIT`).
- **Key names** ride in the record body only, as before; the UI's row model and search text still exclude them (its existing test pins it; the mock's K21 says key names never become catalog projections).
- The UI's Secrets list still counts the keys of `data` (DATA): the field did not move. `object.ts` still never looks into an entry. Its golden test is fed the shape the page now receives.

## Reveal (one key of one Secret, on an explicit press): designed, not built

**Whether the SDK and host give a suitable operation today, without a wire change.**

- A **Get with a representation** cannot: `GetRequest` is `{Route, Reference, Representation}` (SDK `domain.go`), it carries no key, so it returns every value of the Secret, and the runtime's `useResource` keeps the answer in the query cache (`useResource.ts:49`).
- An **instance-scoped action** can, with no wire change. `ActionDescriptor` has an ID, a scope, `ParamsSchema`, `OutputSchema` and a `Dangerous` hint (SDK `ancillary_types.go:156-169`); the host's finite `Action` (`finite_operations.go:405-462`) admits the descriptor, runs it and validates the output; the plugin declares actions per kind (`editor_actions.go:22`) and serves them (`:97`). Design: `kubernetes.secret-value.v1`, scope instance, only on `k8s:/secrets`, params `{ key }` (required), output `{ key, size, encoding: "base64", value }`; it reads that one Secret by namespace and name (with the incarnation precondition the other actions use), returns that one key, errors without any value in their text, `Dangerous: true`; no collection, no source, no cache in the plugin; the plugin's telemetry already logs identifiers only (`native_crud_telemetry.go`) and the host's action diagnostics ids and outcome (`action_diagnostics.go:51`).
- **The renderer half needs a contract change, so it is not made.** `ui/v1` exports no `Get`, `Mutate` or `Action` (`ui/v1.ts:19-103`). The main entry's `useExecuteAction` is not a fit: its result stays in the mutation cache after the component unmounts (`useResourceActions.ts:48-61`; TanStack's default, five minutes [INFERENCE: library default, not run]), it invalidates every resource query on success (`:58`), and it raises an error notification. Reveal needs a new name in `ui/v1` (a MINOR addition by its rule 4): a one-shot, uncached call of an action that returns its value to the caller and leaves nothing in the QueryClient. The activity lane must not carry it (`activity_action.go:17,123` persists a task and publishes the result as an event). It is a host change, **not a wire change**.
- Consent: the host sees the call as `Action` by name only, so a governance rule on this descriptor (the host's call, not the plugin's: `Dangerous` is a hint) belongs with that change.
- The plugin half is not added alone: an action nothing can call is surface without a caller, and the choices above (lane, cache, consent) are the host's. The new UI shows no value, so nothing waits on it.

## Tests

- `pkg/plugin/resource/native_secret_projection_test.go` drives the registration the plugin hands the host for the type, built from discovery (`discoverNativeTypes`, `assembleNativeCatalog`, `nativeRegistration`), so every operation is asked: the list in both representations, the one-namespace list and the label query, the name-narrowed read, Get of each of seven Secrets in both representations, create (a manifest with `stringData`), update and delete, the live source (snapshot, modify, add, remove) and the source narrowed to one name. Each plants self-naming values (text, TLS PEM, a binary blob with `0xff 0x00 0xfe 0x80`, an empty value, a value made by `stringData` and kept in the `last-applied` annotation, an immutable Secret, the same name in another namespace) and scans the JSON and the protobuf of each page, record and frame for each of them in the clear, as base64 and as base64 at its three alignments; then checks identity, type, immutable, labels, other annotations, each key's name and size, and the coverage. A ConfigMap and a kind of another group called `secrets` are sent whole.
- `resourcers/projection_test.go` (names and sizes: text, binary, padded base64, empty, null, a 1 MiB value, text that is no base64, non-text; `stringData` in UTF-8 bytes; the annotation dropped and `annotations` absent when it was the only one; the allowlist; the input never written; the limits) and `resourcers/secret_source_test.go` (the source: snapshot, modify, add, remove, narrowed to one name through a server that honours `metadata.name`, two sources of one Secret).
- UI: a case for the projected shape in `secrets/definition.test.ts`; the golden test is fed the shape the page now receives.

## Other kinds (read-only; nothing changed)

- **ConfigMaps** carry configuration, not secrets, and every read sends every value whole. On the proof cluster: 18 ConfigMaps, 312,581 B of values in 321,046 B of JSON, the largest a made-up 296,000 B (`sec1/large`), then `kube-system/extension-apiserver-authentication` 2,306 B and `kube-proxy` 1,761 B. The page received 896,859 B for the ConfigMaps list, against 194,485 B for a list with no object (the catalog and target calls): about 700 KB for 312 KB of values, because they travel twice (the first set's `Enumerate` and the source view's snapshot). The list shows a key count, the key names and one size. The API allows 1 MiB for a ConfigMap; a page ends early when its records outgrow the wire budget (`native_read.go:253-330`).
- Bytes the page received for each list and what `kubectl get -o json` serves for the kind (fixed plugin, Chromium, one run; about 190 KB of each number is the catalog and target calls of an empty list):

| Kind | Rows | kubectl JSON (B) | Page received (B) |
|---|---|---|---|
| configmaps | 18 | 325,711 | 896,859 |
| secrets | 14 | 715,239 | 261,685 |
| pods | 9 | 116,283 | 535,365 |
| deployments | 2 | 18,019 | 249,744 |
| replicasets | 2 | 15,673 | 240,558 |
| daemonsets | 2 | 13,749 | 239,786 |
| services | 2 | 3,357 | 210,447 |
| namespaces | 7 | 5,262 | 221,724 |
| nodes | 1 | 8,609 | 217,889 |
| statefulsets, jobs, cronjobs, ingresses | 0 | 119 | 192,880 to 194,658 |

- **Pods** keep their whole spec and status (116,283 B of JSON for nine Pods; 535,365 B received). A literal `env` value stays in the record: it is the user's own data, not a Secret (the Pod page already protects some annotation values in the UI, `ui/src/pod/overview/model.ts:381`).
- **Helm releases** are in the Backend catalog (the rendered manifests and the user's values, whole).
- Not measured: CustomResourceDefinitions (the proof cluster has none of size), Events and EndpointSlices.

## Backend catalog

| Class | Where | What | Evidence | Interim |
|---|---|---|---|---|
| (closes the TANGENTIAL entry of K2b-1) | plugin backend `native_read.go:471-507` | Secret values in every record | plugin PR #268; rows 4 to 6 of Result | none needed |
| TANGENTIAL | host runtime `packages/omniviewdev-runtime/src/ui/v1.ts`; plugin `pkg/plugin/resource/editor_actions.go:22,97` | Reveal of one Secret key: a one-shot, uncached `Action` call in `ui/v1` (a MINOR addition), and the plugin's `kubernetes.secret-value.v1` instance action behind it. No wire change: `Action`, `ActionDescriptor` and its schemas exist. The host decides the lane (never the activity lane) and consent | `ui/v1.ts:19-103` has no Get, Mutate or Action; `useResourceActions.ts:48-61`; `finite_operations.go:405`; `activity_action.go:17,123` | none: the new UI shows no value |
| TANGENTIAL | plugin backend `pkg/plugin/resource/clients/clients.go:216` | The informer cache holds each whole Secret in the plugin process for as long as a source lives. A transform on the informers of core Secrets (`SetTransform`, five lines) would keep the values out of the process; the projection already keeps them out of the host and the frontend | `Source` reads the cache's pointers (`base.go:549`) | the projection at the record builders |
| TANGENTIAL | plugin backend `pkg/plugin/helm/release_resourcer.go:62-76`, `request.go:111`, `storage.go:216`, `read.go:35` | A Helm release record (the list and Get alike) is the whole release: `manifest` (every manifest the chart rendered: a rendered Secret's `stringData` or `data` included), `config` (the user's values) and the chart's own files. A probe on `releaseToMap` with a planted token: members `namespace name info chart config manifest version`, the token twice in 923 bytes. Becomes a BLOCKER for a Helm list page | probe, deleted after the run | the new UI has no Helm page |
| TANGENTIAL | plugin backend `native_read.go:471` (`nativeRecord`) | A ConfigMap's values go whole on every read; a list needs the key count, the names and the size. The projection mechanism could carry a second kind, with the values left to the detail page; sizes below | the numbers above | none |

## What remains, and what was not verified

- **Reveal** is not built (above). Until then no page can show a Secret's value: the new UI never did.
- The informer cache and Helm releases (Backend catalog).
- Not verified: the native window and WKWebView; Windows and Linux; the old UI on `main` (what breaks is reasoned from its code, not run); a cluster with Secrets near the 1 MiB the API allows beyond the 512 KiB one of the proof; a CRD-heavy cluster (the sizes of CRDs are not measured); the plugin PR's CI beyond "UI checks".
- CodeRabbit: asked once on PR #268 (the base is not the default branch); its comments and what was done are in the PR's threads.

## Dev tools

In this repository, `docs/ui-next/status/SEC1/` (`.txt` so that none is run by accident; drop the suffix): `sec1-proof.mjs.txt` (the proof: Playwright, kubectl as oracle, every byte the page receives and the Chromium heap scanned for every Secret value), `redo.sh.txt` (the whole procedure on a fresh cluster; takes `HOST`, `PLUGIN`, optionally `BASE`, `WORK`, `OUT`, `ENGINES`), `sec1-secrets.yaml` (the Secrets and ConfigMaps, applied client-side on purpose), and `sec1-cluster.go.txt` (the Go probe against the real API server: copy it to `pkg/plugin/resource/zz_sec1_cluster_test.go` in the plugin checkout; build tag `sec1cluster`, so a normal `go test` never compiles it; run it with `SEC1_KUBECONFIG=<kubeconfig> GOWORK=off GOTOOLCHAIN=local go test -tags sec1cluster ./pkg/plugin/resource -run SEC1Cluster -v -count=1`).

**To repeat the proof:** build the host (`pnpm install`, then `OMNIVIEW_UI=next task build:server` in a checkout of `origin/main`); check the plugin out at the SEC1 commit (and, for the control, at 76e65da); copy `redo.sh.txt`, `sec1-proof.mjs.txt` and `sec1-secrets.yaml` into one directory without the `.txt`; run `HOST=<host> PLUGIN=<plugin> BASE=<plugin at 76e65da> bash redo.sh` (docker, kind, kubectl, helm, go, pnpm, node; about four minutes). It prints one PASS or FAIL line per check and deletes its cluster whatever happens.
