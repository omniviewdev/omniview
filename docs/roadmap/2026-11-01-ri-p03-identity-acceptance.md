# P03 identity close-out acceptance

## Status and gates

Status: draft acceptance. Independent review corrections have passing final local integration checks. Candidate-cohort CI, user-only P03-V approval, and independent re-review remain gates. Native proof remains blocked by `omn-5wbn` (`stale_target`). This receipt does not authorize a merge.

- Packet: P03, [omniview#82](https://github.com/omniviewdev/omniview/issues/82).
- Consumed contracts: P00 identity and P45 structured resource references. No new wire contract or freeze gate.
- Predecessors: [P00 #79](https://github.com/omniviewdev/omniview/issues/79), [P44 SDK #11](https://github.com/omniviewdev/plugin-sdk/issues/11), and [P45 SDK #12](https://github.com/omniviewdev/plugin-sdk/issues/12) are closed.
- Production cutover: [host #192](https://github.com/omniviewdev/omniview/pull/192), merged at `922d1e8cc15a371d58ecc61fc94abf55acf8852d`.
- Workspace: `ri-p03`; branch: `feature/ri-p03-ac10053b`.
- Recorded baselines: host `5b722f3db9e47d40819fa5dd6ac9effa1bc50a94`, Kubernetes `c3952b6bc798ab17268cba191413348cc82b5db1`, Proxmox `c466186e63c0742f9dd8a254e2ecf2bfcd0e6f8d`.
- Kubernetes companion PR: https://github.com/omniviewdev/omniview-plugin-kubernetes/pull/76, targeting `main` with `resource-v2-candidate`.
- Kubernetes candidate: `d2d59feb126e87ff64947a5dfa0271a21d90c098`. Host cohort and gitlink select this exact commit.
- SDK and UI pins remain `0a5b64ed8c2de209fbb02ecce9feba3afd88f28c` and `61bf9c2ad88e7b427404256573941ba80fac4c00`.
- Rebased host baseline: `3f73061544519d4b35fd51c71eef342065268935` (host #335).
- Rebased Kubernetes baseline: `860627e04782ab153335a603497c8c514d3337b1` (Kubernetes #75).
- The candidate retains upstream Kubernetes #75 code. The older PR head `2df894a0e0da660f61d9842a7a8d53450e5aefed` was not treated as equivalent ancestry.

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
| `packages/omniviewdev-runtime/src/types/app.tsx` | `PagePathMigrationResult`, `PagePathMigrator`, and optional `PluginWindow.migratePagePath` |
| `ui/features/plugins/core/{types,PluginService}.ts` | Register the provider-owned callback without parsing provider resource keys |
| `ui/features/workspace/{pagesState,workspaceController,WorkspaceProvider}` | Migrate restored paths, preserve `legacy.path`, and report unresolved entries |
| Kubernetes `ui/src/utils/{builtinResourceTypes,legacyMigration}.ts` | Shared explicit built-in bindings, saved route conversion, and connection-aware preference conversion |
| Kubernetes `ui/src/hooks/useLegacyColumnMigration.ts` and page mounts | Run migration before table choices initialize; report retained unknown preferences |

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
| UI workspace tabs | `PagesState.tabs[tabId].path` persists routes verbatim. Historical Kubernetes routes contain built-in keys such as `resources/core_v1_Pod`. Current collection routes do not establish that historical choices are absent. These choices require a provider-owned migration. |
| UI drawer tabs | `tabs[].properties.opts` can contain a canonical reference or historical terminal selectors. This store requires migration. |
| Core settings and preferences | Current categories, theme, homepage, and table preferences do not define stored object references. Generic settings storage remains schema-owned. |
| Kubernetes plugin Data Store | Favorites, groups, recency, hub sections, debug templates, and connection overrides store UI or connection choices. |
| Kubernetes metric settings | Prometheus service name, namespace, and port select a utility endpoint. Global defaults apply across connections. They are not observed resource addresses. Preserve endpoint fallback semantics. |
| Kubernetes localStorage | Historical column preferences use legacy keys such as `core::v1::Pod`. Current tables read `k8s:/pods`. These persisted collection choices require migration even though they are not object addresses. Keep original storage entries and report unknown keys. |
| Proxmox plugin settings | Cluster configuration file paths are not resource references. No plugin-owned resource-reference store was found. |
| Generic plugin data/settings | The host stores arbitrary plugin-owned JSON. This receipt does not claim that every external plugin schema lacks references. |

Independent review traced the historical persistence boundary. Host #199 (`c4f02318`) saved page paths while its Kubernetes pin was `8dfdb079`. Kubernetes later changed type keys in `f665753`. Saved routes and column choices can therefore predate the canonical cutover. The initial inventory incorrectly treated current collection-only routes as proof that no legacy route or preference migration was needed. That conclusion is withdrawn.

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

The corrected drawer reader accepts slot versions 1 and 2. Normal and panel saves write version 2. Only version 1 runs the historical reference migration, including closed-window adoption. Version 2 returns unchanged.

- Keep complete canonical options unchanged.
- Keep newly saved, SDK-valid opaque selector-only sessions unchanged in version 2. They retain their options and retry behavior.
- Convert a complete saved canonical reference without a route by reusing the tab's explicit `connectionID` as `AccessRoute.connection`.
- Preserve the original options in `properties.resourceReferenceMigration.legacy.opts` for each changed entry.
- Keep any previous migration payload inside that backup. Keep unrelated `legacy` properties unchanged.
- Mark converted entries with `{ version: 1, status: 'converted' }`.
- Mark incomplete or selector-only entries from historical version 1 with `{ version: 1, status: 'unconvertible' }`.
- Remove unconvertible options from the active `opts` field. Do not replay them or create legacy-key aliases.
- Keep only historically migrated converted and unresolved tabs when their backend session expires. Ordinary expired version 2 tabs retain normal pruning.
- Report the affected window and terminal with a warning toast and console warning. Do not log resource bodies or options.
- Reject an unsafe retry with `Saved resource reference unavailable`. Ask the user to open the resource again.
- Show `Terminal session expired` for retained expired migrations. A converted canonical reference offers `Start new session` through the existing session event path.
- Start a replacement only after the user clicks. Reuse saved options, command, route, and reference. An unresolved reference has no restart action.
- Keep conversion and backup stable across save and reload. Do not replace the backup on a second load.

Drawer migration never infers resource identity from a GVK string, body, connection ID, or `namespace/name` pair. A saved connection supplies only an access route for an already complete address. Kubernetes collection-type migration uses exact registered bindings and never constructs an object address.

No new cancellation or queue behavior exists. Migration is synchronous over saved tabs. Canonical operation errors and cancellation remain unchanged.

## Provider-owned route and preference migration

`PluginWindow.migratePagePath(path)` is an optional TypeScript callback. Its exact result kinds are `unchanged`, `migrated` with `path`, and `unconvertible` with `reason`. The host calls it after the owning plugin registers. Core code does not split Kubernetes GVK tokens.

The host migrates only saved paths that the user has not changed since restore. It saves the replacement and the first original as `PageTab.legacy.path`. Page persistence and cross-window transfer preserve this backup. Reloading a canonical path does not rewrite it. Unknown paths remain unchanged and produce a warning toast and console log.

Kubernetes converts built-in historical `group_version_Kind` and `group::version::Kind` segments with its explicit built-in table. The table also serves native manifest navigation. Query strings and fragments remain exact. Known canonical opaque types remain unchanged. Malformed encodings, unregistered versions, CRDs, and unknown kinds are reported rather than assigned guessed plurals. No permanent route alias or redirect remains.

Preference migration covers column visibility, filters, sizing, label and annotation columns, and toolbar filter values. It uses actual configured connection IDs and an explicit plugin-wide key shape. It never infers the connection/type boundary from a suffix regex.

If multiple configured connection prefixes match, migration reports the original key even if only one remaining suffix names a built-in. If no connection matches, only an exact known plugin-wide binding can convert. Unknown, missing-connection, malformed, and ambiguous entries retain their original values and are reported.

Copies use the current canonical type spelling. Original keys stay in place. A first backup is retained under `kubernetes-legacy-preference-backup:` in the same storage namespace. Existing canonical values and existing backups always win. Plugin-local and active host-profile storage remain separate.

The `prod/example-core` and `prod-example/core` collision has explicit regressions. Current opaque keys containing `::` are not reclassified. Resource tables wait for configured connection discovery and migration before initializing saved choices.


## Domain to Go, protobuf, and TypeScript

| Domain | Go and protobuf | TypeScript and persistence |
| --- | --- | --- |
| Address | Existing P45 `resourcev2.ResourceAddress` and its transport mapping | Existing `ResourceAddress`; opaque string fields and structured scope |
| Reference | Existing `resourcev2.ResourceReference`; optional incarnation remains optional | Existing `ResourceReference`; no string-key alias |
| Access route | Existing `resourcev2.AccessRoute` | Existing `AccessRoute`; route remains separate from identity |
| Window slot | WindowService stores an opaque JSON string; no new resource RPC or protobuf message | `DrawerSlot` reads v1/v2 and writes v2. Historical per-tab backup metadata remains independently versioned at 1. |
| Page path migration | No new Go or protobuf message; existing WindowService stores the page JSON | `PagePathMigrationResult` and `PagePathMigrator`; persisted `PageTab.legacy.path` |
| Column preference migration | No new Go or protobuf message; browser preference strings stay exact | `migrateColumnPreferences(Storage, connectionIDs, profilePrefix)` and retained original/backup keys |

Consumers are window/session restore, terminal retry, host registry and graph, runtime list/detail/native query keys, and operation invalidation. P03 owns the saved-reference migration. P15 owns the later live-client cutover.

## Executed checks and evidence

The following results describe the initial candidate before independent review corrections. The final correction checks are listed separately below.
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

Runtime preflight also requires a managed SDK source. The coordinator authorized adding only the pinned SDK repository through `task workspace:edit`. That bootstrap step changed neither SDK source nor the host cohort.

The independently reviewed runtime SDK is `0a5b64ed8c2de209fbb02ecce9feba3afd88f28c`. The retained protocol proof is `/home/mononen/omniview/.omniview-dev/link-protocol.json`. It records workspace protocol, pnpm `12.14.0`, and successful atomic output, peers, and runtime checks. This packet did not rerun the original probe.

The reviewed launch command adds `--reviewed-sdk-revision 0a5b64ed8c2de209fbb02ecce9feba3afd88f28c --link-evidence /home/mononen/omniview/.omniview-dev/link-protocol.json`. No isolation-source override was used.

The first reviewed launch failed after `467.55s`. Generation `891730c5-19fe-4a5c-820c-f69732e89450` reached ready build nodes, then failed at `starting-frontend`. Its error was `stale_target`: `session ownership does not match the selected workspace generation`.

Supported `task workspace:down` completed. The coordinator then authorized `task workspace:edit -- ri-p03 --root /home/mononen/omniview --add-plugin kubernetes --json`. Repository selection alone had not selected the dev plugin.

The corrected selected-plugin launch failed after `343.70s`. Generation `7fe916ad-6a15-4f18-a2bf-8f6d47779797` reported ready host, runtime, binding, provider, Vite-plugin, Kubernetes backend, and Kubernetes UI build nodes. It failed at `starting-frontend` with the same `stale_target` error. No source edit occurred during that launch.

Supported `task workspace:down -- ri-p03 --root /home/mononen/omniview --json` completed again. The runtime slot is released. No third unchanged launch was attempted. No other workspace was touched.

The durable blocker is `omn-5wbn`. No `launchPhase: ready`, selected MCP endpoint, table/detail/editor/navigation smoke, or real WindowService reload proof was obtained. Built artifacts and unit tests do not replace that proof. The PR remains draft.

## CI and review evidence

Draft PR: https://github.com/omniviewdev/omniview/pull/336.

The first head, `e39051da13a7ae2627f879b0e79182d1ee7ea9d7`, passed controlled Go checks, bindings, Windows connection profiles, packaging, render benchmarks, production profiles, build matrices, and application E2E.

The UI job failed on 15 lint errors in the new migration, provider, terminal, and test code. The failed log is https://github.com/omniviewdev/omniview/actions/runs/41365009073/job/125024898621. Braces, statement spacing, and test callbacks were fixed without a behavior change.

After those edits, direct ESLint over changed host TypeScript files passed with no errors. It warned that the runtime test file has no matching root lint configuration. Drawer and terminal Vitest passed again, 5 files and 73 tests. Host TypeScript passed again. No unrelated warning was suppressed.

CodeRabbit skipped automatic draft review. A manual review was requested at https://github.com/omniviewdev/omniview/pull/336#issuecomment-6565868303. The service then reported `Review limit reached`. No inline review finding was available. This is not independent review approval.

## Review-correction verification

Independent review identified P1 historical route/preferences, P2 repeated selector reclassification, and P3 inaccessible expired converted tabs. The corrections above address those findings. They still require independent re-review and candidate-cohort CI. Preliminary owner checks do not replace the integration results below.

After both owners released their files, the integration owner corrected ambiguous connection/type preference parsing. The implementation uses configured connection IDs. It reports `prod/example-core` versus `prod-example/core` ambiguity without choosing the suffix that names a built-in. Toolbar filter values use the same preservation path.

Final executed integration checks:

```sh
# Host workspace
./node_modules/.bin/eslint packages/omniviewdev-runtime/src/types/app.tsx ui/features/plugins/core/types.ts ui/features/plugins/core/PluginService.ts ui/features/workspace/pagesState.ts ui/features/workspace/workspaceController.ts ui/features/workspace/WorkspaceProvider.tsx ui/features/workspace/pageMigration.test.ts ui/providers/BottomDrawer/drawerSlot.ts ui/providers/BottomDrawer/drawerRestore.ts ui/providers/BottomDrawer/resourceReferenceMigration.ts ui/providers/BottomDrawer/provider.tsx ui/providers/BottomDrawer/containers/Terminal.tsx ui/providers/BottomDrawer/__tests__/drawerSlot.test.ts ui/providers/BottomDrawer/__tests__/provider.test.tsx ui/providers/BottomDrawer/__tests__/resourceReferenceMigration.test.ts ui/providers/BottomDrawer/containers/__tests__/Terminal.test.tsx
./node_modules/.bin/vitest run --configLoader runner ui/features/workspace ui/providers/BottomDrawer/__tests__ ui/providers/BottomDrawer/containers/__tests__/Terminal.test.tsx
./node_modules/.bin/tsc -p tsconfig.app.json --noEmit

# Runtime package
../../node_modules/.bin/vitest run --configLoader runner src/hooks/resource

# Kubernetes ui/
./node_modules/.bin/eslint src/utils/builtinResourceTypes.ts src/utils/legacyMigration.ts src/utils/legacyMigration.test.ts src/hooks/useLegacyColumnMigration.ts src/hooks/useLegacyColumnMigration.test.tsx src/entry.ts src/entry.routes.test.ts src/pages/ClustersPage.tsx src/pages/ClusterResourcesRoute.tsx src/components/helm/releases/ReleaseSidebar.tsx
./node_modules/.bin/vitest run --configLoader runner src/utils/legacyMigration.test.ts src/hooks/useLegacyColumnMigration.test.tsx src/entry.routes.test.ts
./node_modules/.bin/tsc --noEmit
```

- Host lint: **PASS**, no diagnostics. Host behavior: **PASS**, 13 files and 153 tests. Host TypeScript: **PASS**.
- Runtime resource behavior: **PASS**, 7 files and 110 tests.
- Kubernetes lint: **PASS**, zero errors and 19 import-order warnings. Kubernetes behavior: **PASS**, 3 files and 49 tests. Kubernetes TypeScript: **PASS**.
- Initial integration lint found 13 host errors and four unnecessary quote escapes in Kubernetes tests. Those were fixed before the final commands above. No rule or test configuration was weakened.
- Route tests use the installed React Router and the real provider migration. They do not inspect source text or re-pin generated strings.

The production page/preferences disk smoke was executed again after the connection-aware correction:

```sh
./node_modules/.bin/esbuild /tmp/p03-route-migration-smoke.ts --bundle --platform=node --format=esm --outfile=/tmp/p03-route-migration-smoke.mjs && node /tmp/p03-route-migration-smoke.mjs
```

Result: **PASS**, `page and preference disk reload passed`. The script imports the production page reducer/parser and Kubernetes migration. It writes actual files, preserves route and preference originals, preserves canonical precedence, reloads, and rejects unknown and ambiguous choices. The executed source is retained in the PR evidence comment; temporary smoke files are removed after publication.

The corrected drawer smoke ran in a real Node process with `node --input-type=module`, using the preserved script on stdin. Result: **PASS**, one converted reference, one retained unresolved reference, and one current opaque selector preserved. It verifies v1-to-v2 upgrade, current v2 non-reclassification, save/reload, and idempotence. It does not substitute for native WindowService or UI proof.

The first corrected host candidate could not merge with current `main`. Its check query returned only a skipped CodeRabbit check, not passing CI. The coordinator authorized rebasing both owned feature branches.

Kubernetes was rebased onto merged #75 at `860627e04782ab153335a603497c8c514d3337b1`. Host was rebased onto #335 at `3f73061544519d4b35fd51c71eef342065268935`. The only host conflicts were the inspected cohort JSON and Kubernetes gitlink. Both now select `2645605318fb6becf7f132b8d6a5a95a0db089ad`, which retains upstream #75 code. SDK and UI pins did not change.

After those rebases, every integration command above was executed again. Host lint and TypeScript passed; host behavior passed 13 files and 153 tests. Kubernetes lint retained the same 19 warnings and no errors; its TypeScript and 49 tests passed. Runtime tests passed 7 files and 110 tests. Both production-module disk smokes passed again. No native retry was made.

The user set the candidate variables for host `bb51bc845f35506a4a5ee73ad854e987f62ba7a2` and SDK `0a5b64ed8c2de209fbb02ecce9feba3afd88f28c`. The coordinator verified those exact values. Kubernetes run [41371902727](https://github.com/omniviewdev/omniview-plugin-kubernetes/actions/runs/41371902727) had first failed its approved-cohort guard under the prior variables. After the user gate, that job was rerun once, with the [reason recorded](https://github.com/omniviewdev/omniview-plugin-kubernetes/pull/76#issuecomment-6566868410).

The rerun passed cohort selection but failed in `arduino/setup-task@v2`: `API rate limit exceeded for 20.221.79.67`. No semantic check ran. The old job was not retried again. The coordinator supplied the action's supported `repo-token: ${{ github.token }}` input. Kubernetes commit `d2d59feb126e87ff64947a5dfa0271a21d90c098` contains that narrow fix and its README note. Existing read-only permissions remain unchanged. No token is persisted and no check is skipped. The host now pins that candidate; renewed user approval of the host CI variable is required. Actual new-head CI must verify the setup fix.

Host `bb51bc845f35506a4a5ee73ad854e987f62ba7a2` passed Go, UI, bindings, packaging, production profiles, build matrices, render benchmarks, and application E2E checks. [Whole-app profile failed](https://github.com/omniviewdev/omniview/actions/runs/41371912891/job/125043988497). Both `gh run view 41371912891 -R omniviewdev/omniview --log-failed` and the full job log stop at profiling-bundle Vite warnings before scenario warmup. The check annotation reports only `Process completed with exit code 1.` No profile artifact was produced. The cause is not established; this is not recorded as an infrastructure failure or a pass. No retry was requested.

The executable smoke sources and results are retained in [host evidence](https://github.com/omniviewdev/omniview/pull/336#issuecomment-6566872467) and [Kubernetes evidence](https://github.com/omniviewdev/omniview-plugin-kubernetes/pull/76#issuecomment-6566872762). Those comments identify the preceding feature-identical cohort; the later change only authenticates CI setup and updates cohort evidence.




## Planned checks, not evidence

- Resolve `omn-5wbn` through the workspace tooling owner, without adding unrelated devcli fixes to P03.
- Native: Kubernetes table, detail, editor-open/cancel, and navigation on `admin@homelab`, without cluster writes.
- Native: exercise saved-slot conversion and unresolved reporting through the real WindowService and a reload.
- CI, CodeRabbit triage, independent review, user merge, and merged-source smoke.
