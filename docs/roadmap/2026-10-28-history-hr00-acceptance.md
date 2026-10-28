# HR00 selected-source and technical acceptance receipt

Date: 2026-10-28. Issue: https://github.com/omniviewdev/omniview/issues/179 (parent #175).
Status: technical inventory complete; current-cohort runtime evidence recorded below. Independent review remains required. No downstream RI/HR gate is accepted here.

## Selected identities and resolution boundary

Managed workspace `history-hr00-acceptance`, UUID `32a75c67-eab5-4e2f-a6de-ec147a13efe4`, collection `historical-resource-context-20261028`. All source paths below are relative to its root. Sources are fresh managed worktrees on `feature/history-hr00-acceptance-32a75c67`; original checkouts are untouched.

| Component | Exact selected commit | Declared version / role |
| --- | --- | --- |
| Host | `7b177308c7ece9f417889f59efac1e8373cef6e5` | app/runtime/providers/Vite-plugin cohort 0.7.4; host requires SDK v0.7.1 |
| Runtime | Same host commit, `omniview/packages/omniviewdev-runtime` | 0.7.4; exports root, `/api`, `/models`, `/runtime`; base-ui peer ~0.7.1 |
| SDK | `5b3ef764d1cf738835a723a749a0cb6c45f85e44` | reviewed v0.7.0 source; must prove replacement, not infer v0.7.1 source from requested version |
| Kubernetes | `32968cc8a5d8fe691a08fae7072d2bf43eef3bad` | plugin ID `kubernetes`, manifest/frontend 0.7.1; SDK v0.7.1 requirement; runtime ~0.7.4 |
| UI | `11a55a53acb67328f743c512757cabd29135f5fc` | base-ui 0.7.1, editors/ai-ui 6.0.1; not older base-ui 0.4.2 |

Declarations: host `go.mod:17`, `package.json:29-33`; Kubernetes `go.mod:14`, `plugin.yaml:1-2`, `ui/package.json:27-29`; selected UI package manifests. Host Go directive 1.26.0; Kubernetes 1.25.0. Both frontend manifests pin native pnpm 12.14.0. Requested versions are not effective resolution evidence.

Host `ui/features/plugins/api/shared_dependencies.ts` and `packages/omniviewdev-vite-plugin/src/sharedPackages.ts` contain the corresponding 32 shared entries, including React/compiler runtime, ReactDOM, TanStack, four runtime entrypoints, base-ui/ai-ui/editors and styles. MUI, Emotion and legacy UI are not shared. Runtime builds before Vite-plugin shim generation; no independent dependency upgrade or second shared map is introduced.

## Existing service versus missing handoff

“Present” means selected source supplies the named existing seam, not history acceptance. “Unavailable” means no usable selected implementation at the inspected public/provider boundary. “Design-only” means a proposal exists. “Blocked” identifies an owning prerequisite rather than inventing a replacement.

| Capability | Actual selected evidence | Classification / owner / missing handoff |
| --- | --- | --- |
| Current-resource identity | SDK `pkg/v1/resource/types.go:15-59` identifies types as group/version/kind. `GetInput:172-177` uses ID/namespace. Runtime `src/hooks/resource/useResource.ts:9-39,61-95` additionally routes by plugin/connection. | Present legacy access-route tuple, **not** authority/incarnation/canonical history identity. P01/P45 canonical domain and exact values design-only/blocked; P03 owns consumer cutover. HR01 references that owner rather than publishing a duplicate DTO. |
| Current Find/query | SDK `types.go:219-249`: typed filters, text, namespaces, order, pagination; result JSON, success, count and continuation. SDK controller `controller.go:155-160,330-353` validates declared fields where provider supports them; otherwise passes through. | Present provider Find seam, not authoritative common compiler or safe CEL profile. P01/P45 numeric admission blocked; P13 compiler/execution unavailable for history. No browser evaluator or narrowed alternate predicate admitted. |
| Schema/catalog | Host provider `backend/pkg/plugin/resource/provider.go:49-58`: groups/types/definitions/capabilities/schema/filter fields. | Present live metadata. P07 owns canonical catalog/admission; undiscovered/deleted evidence cannot require a live catalog entry. HR10/HR20 remain gated. |
| Result protocol | SDK `ListResult`/`FindResult` carry count/cursor; runtime resource hooks use TanStack queries. | Present request results, not P14/P15 canonical progressive result generation/window protocol. History result/runtime handoff unavailable. Draft HC05 is design-only. |
| Subscription/lease | Host `subscriptions.go:5-7,25-49` ref-counts resource event delivery by plugin/connection/type; STATE bypasses gate. | Present live event subscription. Not a durable acquisition/job lease or common result lease. P14/P15 own shared result lifecycle; HR03/HC03 owns proposed feature acquisition semantics. Do not reuse port/process leases as evidence leases. |
| Invocation/errors | `backend/pkg/invocation/invocation.go:23-45,53-61,100-122`: host-issued principal, cloned target, optional authorizer, request ownership/admission. | Present P04/C02 seam. Generation `initial` explicitly lacks revocation. Trusted UI is not a distinct authenticated plugin principal. HR02/HR07 must supply access partition, revocation and cached-evidence authorization policy. |
| Provider transport | Host `provider.go:17-90`: CRUD, connection/watch, metadata, actions, relationship, health and resource-event calls. SDK `pkg/v1/resource/plugin/client.go`/`server.go` translate protobuf and propagate sessions/cancellation. Kubernetes `pkg/main.go:124-129` registers resource, exec, networker, logs, metric. | Present live provider capability set. No history discovery/plan/open/checkpoint/coverage transport in this interface. HR05 awaits HC01-HC05 and negotiated optional SDK capability; P05/P10 live sessions do not imply durable audit replay. |
| Storage/index | Host `resource/registry/memory_store.go` updates current membership, not immutable evidence. Existing standalone storage probe is separate. | Durable history store unavailable. HR02 policy remains unaccepted; HR06 must prove atomic evidence/checkpoint writes. Driver experiment is not permission to persist sensitive audit bytes. |
| Comparison/context | Existing editable resource drawers and Monaco textual diff are presentation seams. `2026-10-28-history-contract-handoff.md` proposes citation, snapshots, context and comparison. | HC06/HC07 design-only; no usable public history ABI. HR11/HR12 own runtime/comparison after contracts. |
| Contributions/search | Existing extension registry and global command-search provider/navigation contracts. | Present navigation seam. P26/P42/P43 do not establish authoritative retained-history search; P35 owns authorized union. HR21/HR23 must consume host query/results. |

CEL comparison **and optimized membership** faults remain owning P01/P45 blockers per [prerequisite receipt](2026-10-28-history-prerequisite-execution.md#confirmed-production-blocker). Newly authorized narrow dependency-patch review is separate work, not a pin admitted by HR00. HR01/HR03/HR04 [contract handoff](../superpowers/specs/2026-10-28-history-contract-handoff.md) stays design-only. A truthful missing-handoff matrix allows HR00 inventory acceptance without claiming any of these implementations exist.

## Affected caller map

| Entry / source | Current contract and required history boundary |
| --- | --- |
| `omniview/ui/pages/[plugin]/[connectionID]/resources/ResourceTableView.tsx`; `ui/components/tables/Resources/ResourceTableContainer.tsx` | Live route/table; table props are pluginID, connectionID, resourceKey, with accessor-derived ID/namespace. Local table search/column state is not retained-evidence search. Preserve canonical authority/incarnation when P03/HR14 cut over. |
| `ui/components/tables/Resources/cells/ResourceLinkCell.tsx`; `ui/hooks/useRightDrawer.ts`; `ui/providers/RightDrawerProvider.tsx`; `ui/components/displays/RightDrawer.tsx` | Resource-link and drawer navigation are live-resource entrypoints. HR14 must carry an explicit historical context, not silently fetch latest by name. |
| `ui/federation/LinkedResourceDrawer.tsx:52-53,164-185` | Editable YAML submit/cancel/reset/diff fallback. Historical evidence requires read-only snapshot resolution and unavailable/denied fidelity, never reuse live mutation actions as historical controls. |
| Runtime `src/hooks/resource/useResource.ts`, `useResources.ts`, `useResourceSearch.ts`, `resourceQueryKeys.ts` | Current cache/fetch/mutation tuple. History needs approved runtime query/context APIs, not a second browser store or aliases inside live keys. |
| Runtime `useResourceGraph.ts:6-38,64-71`, `useRelatedResources.ts`, `useRefetchOnGraphChange.ts`; host `resource/graph_service.go` | Root graph reads use plugin/connection/type/namespace/ID; hop depth caps 5. Refetch follows current graph changes. HR22 must distinguish current topology from historical evidence/provenance and carry canonical context. |
| `ui/features/command-search/useGlobalCommandSearch.ts:120-140,152-167`; `SearchProviderContexts.tsx`; `GlobalCommandSearch.tsx`; header `HeaderSearchArea.tsx` | Existing palette dispatches admitted providers and opens live drawer targets. History may contribute navigation, but authoritative historical search stays host-side. No browser scan of retained records. |

Additional RI dependencies from work-package §4 remain explicit: P31/P32 saved-versioned documents → HR23; P39–P41 index lifecycle → HR24; P46/P47 admission/ABI → HR26. No accepted history-specific persistence, index-management or published ABI handoff is supplied by this cohort receipt. Their downstream status is unavailable **as a history handoff**, not a claim that all generic implementation is absent. P27 declarative visualization is optional for full custom historical views; it is not an artificial HR00 blocker. P35 authorized target union remains required for HR21 rather than inferred from the palette's connection scopes. These gates must be reviewed under their existing owners before consumption.

This map covers affected contract surfaces, not a claim that every future product renderer is known. No caller migration is performed before its owning canonical handoff.

### Selected Kubernetes caller chain and distinct identities

The host-generic map above is not the whole selected plugin path. The following paths are relative to `kubernetes/ui/src` unless prefixed with `omniview/`. These are inspected selected-source contracts, not migrated history callers.

| Selected caller / exact lines | Existing identity and dispatch boundary | Required owning cutover |
| --- | --- | --- |
| `components/shared/table/ResourceTable/index.tsx:138-144,227,247-267` | `useResources` and TanStack row identity use `metadata.uid`. Row click calls `openDrawer(drawer, {data: row.original, resource: {id: row.id, name: metadata.name, key, connectionID, pluginID: 'kubernetes'}})` directly. It carries observed row data and a UID-shaped drawer ID; it does **not** perform the linked-resource name Get first. | P03/HR14 must preserve the observed incarnation and distinguish retained evidence from current row data. A name-only historical lookup cannot replace this boundary. |
| `entry.ts:245-275`; `components/shared/sidebar/createDrawerViews.tsx:22-61,65-76` | Resource-keyed plugin drawer factories combine shared actions/editor submit with standard Overview, Related, Graph, Metrics, Events and Editor views. The dynamic-resource default uses GenericResourceSidebar. Every standard view mounts DrawerActionsBridge. | HR14 must explicitly choose read-only historical views and independently admitted live actions. Changing only the host generic fallback does not cover registered plugin drawers. |
| `omniview/ui/providers/RightDrawerProvider.tsx:238-245,272-298,322-344` | Direct `openDrawer` accepts supplied data/context. `showResourceSidebar` instead prefers the registered plugin drawer factory, then falls back to LinkedResourceDrawer; it fetches current `ResourceClient.Get` using resourceID/namespace. It checks cancellation/supersession and optional `validateData`, then opens with the fetched object and lookup ID. This path can therefore yield the full plugin drawer, not merely the generic editor. | HR14 owns explicit historical snapshot/context dispatch across **both** paths, preserving incarnation and preventing silent name-reuse/latest-state substitution. |
| `components/kubernetes/sidebar/ResourceGraphView.tsx:129-143,181-189` | Graph root converts UID-shaped `ctx.resource.id` to `ctx.data.metadata.name` when available, because graph nodes are name-keyed. Graph-node click passes node plugin/connection/type/namespace/ID to `showResourceSidebar`, triggering a current Get. No evidence citation or retained incarnation travels on that click. | HR22 owns historical graph provenance/context and canonical graph pivots; HR14 owns the destination drawer. Do not label this current name-based graph as historical topology. |
| `components/kubernetes/sidebar/RelatedResourcesView.tsx:98-118,123-135`; `components/shared/ResourceLinkChip.tsx:72-84` | Related root similarly converts drawer UID to metadata name, and queries `useRelatedResources` by live tuple. Each related result renders ResourceLinkChip with the graph resource ID/namespace/type. The chip calls `showResourceSidebar`, so related navigation also performs a current lookup without a retained citation. | HR22 must preserve explicit relationship observation/provenance and context; HR14 must open the intended historical incarnation rather than today's object at the same address. |
| `entry.ts:128-132,432-439`; `search/navigation.ts:37-40`; `search/provider.tsx:135-146,185-201,213-220,278,296-302` | Connection search scope comes from route params; plugin destination paths stay connection/resource routes. Resource search lists at most 200 current objects per requested page, ranks them locally, and emits name/namespace targets with optional UID; result IDs prefer UID. Current Get and `validateResource` check name/namespace plus UID when supplied. OPEN_RESOURCE dispatches `context.openResource`; the provider exports that validator. This is live palette discovery, not retained-evidence query execution. | HR21/HR23 own authoritative historical discovery; HR14 owns historical destination/context. Preserve the optional live UID guard rather than misdescribing search as an unguarded name pivot or a canonical history identity. |
| `omniview/ui/features/command-search/controller.ts:1129-1157`; `omniview/ui/features/command-search/useGlobalCommandSearch.ts:122-143`; `omniview/ui/providers/RightDrawerProvider.tsx:327-344` | Search execution carries the provider validator into the host drawer call. Host checks plugin readiness and connection status, then current Get data must pass the validator before opening. Failed UID match reports “Resource identity changed. Search again.” The opened context still uses the name lookup ID, unlike table row UID identity. | HR14 must retain explicit current-versus-historical navigation and authorization; HR21 must not turn this live validation callback into evidence-cache authority. |
| `components/kubernetes/KubernetesSearchActionContext.tsx:20-59,62-66` | Search action preparation performs a fresh current Get and validates name/namespace plus optional UID before resolving action dependencies. It carries current object data into a KubernetesActionTarget, independently of drawer rendering. | HR14 must keep live action admission separate from historical snapshots; neither opening historical evidence nor a matching display name authorizes these actions. |

Thus table UID/observed row, graph name/address, search name plus optional UID guard, and canonical retained authority/incarnation/citation are four distinct boundaries. Existing guards are useful but do not supply the missing RI/HR history identity contract. This documentation correction requires no application-source change or repeated runtime smoke; the current-cohort execution below remains the exercised evidence. Independent re-review must accept this expanded map before HR00 is accepted.

## Selected UI and configuration inventory

Selected `ui/packages/base-ui/src/components/timeline/Timeline.tsx:31-65` is a composed item list with timestamp/icon/color and controlled or uncontrolled expandable details. It is **not** a temporal histogram, brush, viewport/zoom, density aggregator or progressive evidence virtualizer. Those interactions remain HR13 work, not an available Timeline capability.

`date-range-picker/DateRangePicker.tsx:13-34` exposes `{start,end}: Date|null`, limits, disabled dates, controlled change and read-only. `date-time-picker/DateTimePicker.tsx:14-30` supplies Date, limits, seconds and 12/24-hour display. `time-picker/TimePicker.tsx:10-20` supplies Date, seconds, hour-cycle and minute step. DatePicker/DateField are selected calendar/input primitives. These contracts do not expose a time-zone or lossless nanosecond instant domain. Explicit zone, DST ambiguity, half-open query bounds and exact wire conversion need accepted HR04/RI timestamp semantics; JavaScript Date is display/input only.

Selected `ui/packages/editors/src/components/diff-viewer/DiffViewer.tsx:9-14,30-35,54-74` takes original/modified strings, language, side-by-side/inline mode; defaults readOnly=true and disposes models. It performs Monaco textual comparison, not semantic Kubernetes patch replay, secret-aware normalization or evidence-backed snapshot reconstruction. HC07 must supply comparison fidelity/provenance; unknown patch media type must not become guessed JSON Patch.

Configuration follows SDK `settings.Setting` declarations, not a new source-settings framework. Kubernetes `pkg/main.go:55-117` declares kubeconfigs with multi-file picker, shell, layout options, client log-level and Prometheus fields. Default kubeconfig is `~/.kube/config`; profile isolation alone is insufficient. Host hooks `ui/hooks/settings/usePluginSettings.ts`, `useCoreSettings.ts`, `useCategorySettings.ts` and runtime `src/context/settings/SettingsContext.tsx`, `hooks/settings/useSettings.ts` supply existing settings integration. HR09/HR17 source path/range/redaction/budget controls must use reviewed feature semantics and this framework. Secrets/credentials never become evidence or browser-persisted source configuration.

## Sample/fixture collection plan reused

Reuse merged Kubernetes `hack/history-audit.mjs`, `hack/history-audit.test.mjs` and existing [fixture receipt](2026-10-28-history-prerequisite-execution.md#real-kubernetes-audit-fixture), not another generator or production log fetch. Kind v0.27.0 and node v1.32.2 digest are pinned there. Owned create/exercise/inspect/delete uses random cluster, private kubeconfig and mount ownership checks. Existing exercised corpus covers ConfigMap create/patch/delete/recreate with distinct UIDs, 403 denial, dry-run, Event, custom-resource status and Secret/TokenReview sentinel exclusion. Keep raw audit logs, private kubeconfigs and ownership receipts outside Git.

For downstream normalization review: collect only explicitly selected fixture-namespace records; preserve native auditID/stage, GVR/version/subresource, actor/impersonator distinctions, event/request/observation times and optional UID. Do not treat stage as globally unique delivery identity. Run configured redaction before summaries/indexes/export; include absent-body, denied, dry-run and incarnation cases. Publish only reviewed sanitized samples with provenance/precision/coverage limitations; no production credentials or raw logs. Existing active-file inspector does not prove rotated-log completeness. CloudWatch/EKS samples remain unavailable until explicit approved source access; synthetic/local data does not establish cloud normalization acceptance.

## Current-cohort exercise

The earlier `resource-history-runtime` browser proof used host `e4d4a31...` and Kubernetes `9bfa03d...`, not this selected host/fixture cohort. Its bridge/shared-instance evidence is retained as earlier evidence, not relabeled current. Fresh managed launch is required below. Failed-install recovery evidence in the original `resource-history` workspace remains untouched: recorded installer transaction, unverified generated root lockfile refusal, incompatible published-package peer audit and recovery attempt remain described in the prerequisite receipt. No reset, bypass, package publication or tooling repair is authorized here.

### Executed current-cohort receipt

Selected CLI: `/Users/joshuapare/Library/Caches/omniview-dev-cli-v2/b0cdc8702f11b82b6d44b67ba85892d3e92480976616787f5209dcc1f940d081/binaries/a5d2d8fa5e7c11bf94b11d22778e8230df2c9d068575647eb0cddcbb9d4fb8bf/omniview-dev`.

Private empty HOME `/tmp/omniview-hr00-home.aOfwd0` also supplied USERPROFILE and separate XDG config/cache. KUBECONFIG, AWS_CONFIG_FILE and AWS_SHARED_CREDENTIALS_FILE pointed at nonexistent private files; AWS_EC2_METADATA_DISABLED=true. No profile seed or user cluster was loaded. Canonical `OMNIVIEW_PNPM_EXECUTABLE=/opt/homebrew/Cellar/pnpm/12.14.0/bin/pnpm` selected native pnpm; no peer/preflight audit was bypassed.

The first `workspace up` returned exit 3:

```json
{"error":{"code":"link_evidence_required","message":"provide --link-evidence with the actual successful pinned protocol probe report"}}
```

`workspace evidence resource-history-runtime --root "$COLLECTION" --json` returned the reusable actual protocol receipt:

```json
{"protocol":"workspace","versions":["12.14.0"],"atomicDist":true,"peers":true,"runtime":true}
```

That exact output was saved outside Git as `$PRIVATE_HOME/link-evidence.json`. Normal managed launch then ran:

```sh
"$DEV" workspace up history-hr00-acceptance --root "$COLLECTION" \
  --mode browser --reviewed-sdk-revision 5b3ef764d1cf738835a723a749a0cb6c45f85e44 \
  --link-evidence "$PRIVATE_HOME/link-evidence.json" --watch=false --timeout 12m --json
```

Observed exit 0 in 236.46 seconds, `phase=complete`, `launchPhase=ready`, generation `44e17a74-5e54-4cfa-af28-44aa61c1a3bd`. All eleven build nodes reported ready, including bindings, runtime, Vite-plugin, UI packages and both host/plugin consumers. Plugin build/Vite/RPC/controller each reported ready. Managed health reported dependencies/current, servedSource/current and readiness/authenticated; sourceReload remained unverified. No HMR or native desktop acceptance is inferred.

Actual dependency queries:

```sh
# In omniview
GOWORK=off GOFLAGS= go list -modfile=../.local/toolsrc/hostmod/host.mod -m -json github.com/omniviewdev/plugin-sdk
# In kubernetes
GOWORK=off GOFLAGS= go list -m -json github.com/omniviewdev/plugin-sdk
```

Both returned requested `Version: v0.7.1` and `Replace.Path`/`Dir` equal to this workspace's selected `plugin-sdk` path, GoVersion 1.25.0. Host used supervisor-produced host.mod; Kubernetes used managed replacement. Thus both execute reviewed v0.7.0 source commit, not a guessed published v0.7.1 implementation.

A Node filesystem realpath/package-version query from both `omniview/node_modules` and `kubernetes/ui/node_modules` returned identical roots: React 19.2.4 and ReactDOM 19.2.4 under aggregate `node_modules/.pnpm`; runtime 0.7.4 under selected host package; base-ui 0.7.1 and editors 6.0.1 under selected UI source. This is actual installed resolution, not only package ranges.

Browser opened actual Wails endpoint `http://127.0.0.1:35445/`, not asset Vite. Main-realm boot identity matched the descriptor UUID/generation. `Object.isFrozen(__OMNIVIEW_BOOTSTRAP__)` and `.identity` both returned true. The separately exposed `__OMNIVIEW_INSTANCE__` object was not frozen; no immutability claim is made for that object. Kubernetes eventually reached `phase=ready`, `ready=true`, routeVersion 1, no validation errors, no dependency warnings and no recent contribution crashes. It rendered “No Clusters Found” and the private workspace development badge.

Actual plugin-server generated shim imports were compared against host `__OMNIVIEW_SHARED__`, yielding:

```json
{"react":true,"reactDOM":true,"runtime":true,"baseUI":true,"editors":true,"connections":[]}
```

Comparisons used React `useState`, ReactDOM `createPortal`, runtime `PluginWindow`, base-ui `Button`, editors `DiffViewer`. `connections` is the actual awaited `__OMNIVIEW_SHARED__['@omniviewdev/runtime/api'].ResourceClient.LoadConnections('kubernetes')` result through Wails/host/provider. The host exposed all 32 shared modules. An initial test tried to locate React in the bounded request log and failed with `missing actual import react.mjs`; reading generated filenames and importing from the observed plugin-server shim directory completed the real comparison. No application source was changed for the probe.

Browser diagnostics reported only the aborted HEAD request `/wails/custom.js` (`net::ERR_ABORTED`); no page exception appeared in its error entries. Screenshot captured actual ready empty-state surface. Browser tab was released. `workspace down history-hr00-acceptance --root "$COLLECTION" --json` exited 0 in 1.16 seconds, using the same private HOME; only this owned runtime was stopped. Private profiles, install/build receipts and supervisor logs remain outside committed source. No fixture was recreated and no user credentials were queried.

Disposition: HR00's reachable inventory and current-cohort dependency/bridge/singleton acceptance evidence are complete for independent review. This receipt makes HR01/HR02 assignable without accepting their designs or security decisions. Canonical identity/profile, authoritative compiler/results/runtime, durable acquisition/storage, comparison/context and release handoffs remain gated as listed above. Full Resource History, real-cluster ingestion, native desktop and automatic reload are not claimed. No separate test/lint/formatter barrier was run; actual managed build and application smoke above are the exercised verification.
