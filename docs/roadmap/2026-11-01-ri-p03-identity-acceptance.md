# P03 identity close-out acceptance

## Status and gates

Status: draft acceptance. Changed-path Go and TypeScript checks passed. The full local Go suite failed. Native proof is blocked by `omn-5wbn` (`stale_target`). Independent review and controlled CI remain merge gates. This receipt does not authorize a merge.

- Packet: P03, [omniview#82](https://github.com/omniviewdev/omniview/issues/82).
- Consumed contracts: P00 identity and P45 structured resource references. No new wire contract or freeze gate.
- Predecessors: [P00 #79](https://github.com/omniviewdev/omniview/issues/79), [P44 SDK #11](https://github.com/omniviewdev/plugin-sdk/issues/11), and [P45 SDK #12](https://github.com/omniviewdev/plugin-sdk/issues/12) are closed.
- Production cutover: [host #192](https://github.com/omniviewdev/omniview/pull/192), merged at `922d1e8cc15a371d58ecc61fc94abf55acf8852d`.
- Workspace: `ri-p03`; branch: `feature/ri-p03-ac10053b`.
- Recorded baselines: host `5b722f3db9e47d40819fa5dd6ac9effa1bc50a94`, Kubernetes `c3952b6bc798ab17268cba191413348cc82b5db1`, Proxmox `c466186e63c0742f9dd8a254e2ecf2bfcd0e6f8d`.

Only the user merges. The packet and merge ticket remain open until reviewed evidence and merged-source smoke pass.

## Artifacts and exact names

| Artifact | Purpose |
| --- | --- |
| `backend/pkg/plugin/resource/registry/identity_test.go` | `TestCanonicalAddressKeyCollisionCorpus`, `TestCanonicalAddressKeyScopeOrderAndIncarnation`, and `TestMemoryStoreRecreationWithoutIncarnationIsNotDetected` |
| `packages/omniviewdev-runtime/src/hooks/resource/resourceQueryKeys.test.ts` | Detail, collection, native-input, route, representation, and operation-invalidation cache corpus |
| `ui/providers/BottomDrawer/resourceReferenceMigration.ts` | `migrateDrawerResourceReferences` and `hasUnresolvedResourceReference` |
| `ui/providers/BottomDrawer/provider.tsx` | Apply migration at saved-slot load; report unresolved references with a toast and log |
| `ui/providers/BottomDrawer/drawerRestore.ts` | Retain converted and unresolved tabs when no backend session survives |
| `ui/providers/BottomDrawer/containers/Terminal.tsx` | Reject unsafe retry and explain how to open a new terminal |
| Drawer migration, provider, and terminal tests | Conversion, preservation, reporting, and reload regression coverage |
| `ui/utils/resources.ts` | Remove the unused `parseResourceKey` function and its documentation |

The TypeScript language service found only the `parseResourceKey` declaration. Text search found only that declaration and its example comment. No caller changed.

## Identity and ownership

The host still owns `CanonicalAddressKey`, record keys, membership keys, and resource admission. The client does not mint host keys.

The collision corpus covers global and two scoped resources with the same name. It also covers `/`, `::`, `|`, Unicode, Unicode normalization differences, Proxmox node-local VM IDs, providers, authorities, types, and scope tuple boundaries.

Address identity excludes incarnation. References preserve optional incarnation. The corpus tests both absent and present incarnation without changing logical address equality. SDK JSON sorts scope entries; the roundtrip assertion checks the complete canonical reference. `CanonicalAddressKey` has no public inverse parser.

Without source incarnation, the store cannot detect delete-and-recreate at the same address. The new test records that limitation explicitly. It does not invent a recreation token.

Detail cache keys retain the full reference, including incarnation. Native query keys retain exact bound input. Collection keys distinguish provider, authority, type, and structured scope. They intentionally do not distinguish individual object IDs or incarnations. Mutation and action hooks retain the shared `resourceQueryKeys.all(pluginID)` invalidation prefix.

The existing default-table caller remains on the canonical host-backed path. This packet does not repair its old listener. P15 owns listener and runtime-client removal.

## Persisted reference inventory

| Store | Persisted shape and disposition |
| --- | --- |
| Go WindowService session | `windows.json` stores per-window `pages` and `drawer` JSON strings. The UI owns each slot's schema. |
| UI workspace tabs | `PagesState.tabs[tabId].path` persists routes verbatim. Current host, Kubernetes, and Proxmox resource routes select a connection and collection type, not an object ID. |
| UI drawer tabs | `tabs[].properties.opts` can contain a canonical reference or historical terminal selectors. This store requires migration. |
| Core settings and preferences | Current categories, theme, homepage, and table preferences do not define stored object references. Generic settings storage remains schema-owned. |
| Kubernetes plugin Data Store | Favorites, groups, recency, hub sections, debug templates, and connection overrides store UI or connection choices. |
| Kubernetes metric settings | Prometheus service name, namespace, and port select a utility endpoint. Global defaults apply across connections. They are not observed resource addresses. Preserve endpoint fallback semantics. |
| Kubernetes localStorage | Sidebar ordering, expansion, columns, filters, namespace selections, and manifest mode are collection or editor preferences. Type keys remain opaque. |
| Proxmox plugin settings | Cluster configuration file paths are not resource references. No plugin-owned resource-reference store was found. |
| Generic plugin data/settings | The host stores arbitrary plugin-owned JSON. This receipt does not claim that every external plugin schema lacks references. |

Evidence anchors include `backend/window/{persistence,service}.go`, `ui/features/windows/windowState.ts`, `ui/features/workspace/{workspaceController,pagesState,pagePaths}.ts`, and `ui/providers/BottomDrawer/{tabs,drawerSlot,drawerRestore}.tsx` or `.ts`.

Plugin anchors include Kubernetes `hooks/useClusterPreferences.ts`, `types/clusters.ts`, `features/debug/config.ts`, `hooks/useStoredState.tsx`, `hooks/useSidebarOrder.ts`, `utils/metricParams.ts`, and `pkg/plugin/metric/prometheus.go`. Proxmox anchors include `pkg/main.go`, `ui/src/constants.ts`, `ui/src/entry.ts`, and `ui/src/utils/refs.ts`.

Tool searches used these patterns over the host UI, backend window/settings/data stores, runtime, and both plugin repositories:

```text
parseResourceKey
localStorage|sessionStorage|persist\(|Store\[|WriteFile|ReadFile|SetSetting|GetSetting
resourceId|resourceID|resourceKey|ResourceAddress|::|namespace.*name
GetState|SetState|SaveState|snapshotSession|restoreWindows
DataClient|data\.Set|data\.Get|WriteToGlobalStore|ReadFromGlobalStore
usePluginData|localStorage|sessionStorage|indexedDB|useStoredState|storage\.set|setItem\(
prometheusService|prometheusNamespace|metricConfig
resource/:|:resource|:resourceID|resourceId|resourceID|/resource/|/resources/
```

These searches were followed by reads of store shapes, writers, loaders, and consumers. No blanket absence claim replaces the drawer migration.

## One-way migration and reporting

Migration runs after `parseDrawerSlot`, before tabs hydrate. Normal save writes the result through the existing WindowService slot.

- Keep complete canonical options unchanged.
- Convert a complete saved canonical reference without a route by reusing the tab's explicit `connectionID` as `AccessRoute.connection`.
- Preserve the original options in `properties.resourceReferenceMigration.legacy.opts` for each changed entry.
- Keep any previous migration payload inside that backup. Keep unrelated `legacy` properties unchanged.
- Mark converted entries with `{ version: 1, status: 'converted' }`.
- Mark incomplete or selector-only entries with `{ version: 1, status: 'unconvertible' }`.
- Remove unconvertible options from the active `opts` field. Do not replay them or create legacy-key aliases.
- Keep converted and unresolved tabs and their backups when no backend session survives. Do not discard migrated references after reload.
- Report the affected window and terminal with a warning toast and console warning. Do not log resource bodies or options.
- Reject an unsafe retry with `Saved resource reference unavailable`. Ask the user to open the resource again.
- Keep conversion and backup stable across save and reload. Do not replace the backup on a second load.

No conversion infers provider, authority, type, scope, ID, or incarnation from a GVK string, body, connection ID, or `namespace/name` pair. A saved connection supplies only an access route for an already complete address.

No new cancellation or queue behavior exists. Migration is synchronous over saved tabs. Canonical operation errors and cancellation remain unchanged.

## Domain to Go, protobuf, and TypeScript

| Domain | Go and protobuf | TypeScript and persistence |
| --- | --- | --- |
| Address | Existing P45 `resourcev2.ResourceAddress` and its transport mapping | Existing `ResourceAddress`; opaque string fields and structured scope |
| Reference | Existing `resourcev2.ResourceReference`; optional incarnation remains optional | Existing `ResourceReference`; no string-key alias |
| Access route | Existing `resourcev2.AccessRoute` | Existing `AccessRoute`; route remains separate from identity |
| Window slot | WindowService stores an opaque JSON string; no new resource RPC or protobuf message | Existing `DrawerSlot` v1; migration metadata lives in opaque tab properties |

Consumers are window/session restore, terminal retry, host registry and graph, runtime list/detail/native query keys, and operation invalidation. P03 owns the saved-reference migration. P15 owns the later live-client cutover.

## Executed checks and evidence

1. `gh issue view 82 -R omniviewdev/omniview --json title,body,comments,url` and `--json body --jq .body`: read acceptance. Plain `gh issue view` failed on deprecated classic-project fields.
2. TypeScript language-service `getReferencesAtPosition` on `ui/utils/resources.ts`: one result, the declaration. Used an isolated `/tmp` language-service install, not workspace dependency mutation.
3. `task check:go-test`: **FAIL**. Resource, graph, indexer, and window packages passed. The initial new scope-order assertion failed and was corrected to the SDK's canonical JSON order.
4. `GOWORK=off GOFLAGS= GOCACHE=/home/mononen/omniview/workspaces/ri-p03/omniview/.local/cache/go-build go test ./backend/pkg/plugin/resource/registry -count=1`: **PASS**, `0.083s`, after that correction.
5. Executable Eval/Bun smoke imported the production drawer parser, serializer, and migration. It wrote a temporary slot file, converted one complete reference, retained one unresolved entry, saved, reloaded, and checked idempotence: **PASS**. Temporary files were removed. An initial harness assertion used cross-realm object equality; serialized-value assertions fixed the harness without source changes.
6. `../../node_modules/.bin/vitest run --configLoader runner src/hooks/resource` from `packages/omniviewdev-runtime`: **PASS**, 7 files and 110 tests. The package-local `./node_modules/.bin/vitest` was absent, so the installed host binary was used.
7. `./node_modules/.bin/vitest run --configLoader runner ui/providers/BottomDrawer/__tests__ ui/providers/BottomDrawer/containers/__tests__/Terminal.test.tsx`: **PASS**, 5 files and 73 tests. This includes retention of converted choices after an expired session reloads.
8. `./node_modules/.bin/tsc -p tsconfig.app.json --noEmit`: **PASS** after the supported lifecycle rebuilt runtime declarations. The first run failed with 431 diagnostics after plugin selection invalidated bootstrap. Of those, 210 were missing-module diagnostics. No compiler error was suppressed.

The full Go suite also failed outside the changed code:

- `workspace_selection_test.go:311`: `No version is set for command node` in a temporary selected UI directory.
- `sdk_rpc_contract_test.go:40`: `no space left on device` writing the packet's Go cache.
- `supervisor_bridge_test.go:206`: `devsession: ownership conflict: PID was reused or executable changed`.
- `toolchain_test.go:277`: the actual asdf Node path did not match the requested renamed runtime.
- `toolchain_test.go:304`: `selected pnpm must be its native executable, not a script or Corepack shim`.

These failures were not rerun merely to confirm them. They remain failed-suite evidence, not a full-suite pass.

## Native runtime prerequisites

The first authorized `omniview-native-env task workspace:up -- ri-p03 --root /home/mononen/omniview --timeout 40m --json` stopped with `reviewed_sdk_required`.

Runtime preflight also requires a managed SDK source. The coordinator authorized adding only the pinned SDK repository through `task workspace:edit`. No SDK source or host cohort changed.

The independently reviewed runtime SDK is `0a5b64ed8c2de209fbb02ecce9feba3afd88f28c`. The retained protocol proof is `/home/mononen/omniview/.omniview-dev/link-protocol.json`. It records workspace protocol, pnpm `12.14.0`, and successful atomic output, peers, and runtime checks. This packet did not rerun the original probe.

The reviewed launch command adds `--reviewed-sdk-revision 0a5b64ed8c2de209fbb02ecce9feba3afd88f28c --link-evidence /home/mononen/omniview/.omniview-dev/link-protocol.json`. No isolation-source override was used.

The first reviewed launch failed after `467.55s`. Generation `891730c5-19fe-4a5c-820c-f69732e89450` reached ready build nodes, then failed at `starting-frontend`. Its error was `stale_target`: `session ownership does not match the selected workspace generation`.

Supported `task workspace:down` completed. The coordinator then authorized `task workspace:edit -- ri-p03 --root /home/mononen/omniview --add-plugin kubernetes --json`. Repository selection alone had not selected the dev plugin.

The corrected selected-plugin launch failed after `343.70s`. Generation `7fe916ad-6a15-4f18-a2bf-8f6d47779797` reported ready host, runtime, binding, provider, Vite-plugin, Kubernetes backend, and Kubernetes UI build nodes. It failed at `starting-frontend` with the same `stale_target` error. No source edit occurred during that launch.

Supported `task workspace:down -- ri-p03 --root /home/mononen/omniview --json` completed again. The runtime slot is released. No third unchanged launch was attempted. No other workspace was touched.

The durable blocker is `omn-5wbn`. No `launchPhase: ready`, selected MCP endpoint, table/detail/editor/navigation smoke, or real WindowService reload proof was obtained. Built artifacts and unit tests do not replace that proof. The PR remains draft.

## Planned checks, not evidence

- Resolve `omn-5wbn` through the workspace tooling owner, without adding unrelated devcli fixes to P03.
- Native: Kubernetes table, detail, editor-open/cancel, and navigation on `admin@homelab`, without cluster writes.
- Native: exercise saved-slot conversion and unresolved reporting through the real WindowService and a reload.
- CI, CodeRabbit triage, independent review, user merge, and merged-source smoke.
