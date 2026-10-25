# P00 / C00 selected-source baseline execution

Status: **P00 / C00 accepted after independent technical review** for the selected browser-mode source cohort. Acceptance covers the evidence and limits below; downstream contracts require their own freeze/verification.

## Selected committed cohort

| Repository | Selected immutable commit | Declared contract |
| --- | --- | --- |
| omniview | `fd50802230bd2df7f101c23fd85061c11dcd9aa8` | Go 1.26.0; SDK v0.6.0; runtime 0.5.0; base-ui ~0.5.0; editors/ai-ui ~4.0.0; native pnpm 12.14.0 |
| plugin-sdk | `1e92fb518b117814acb504aaae1772ff39abcdef` | Peeled released tag v0.6.0; reviewed shared isolation/profile contracts; Go 1.25.0 |
| ui | `229a060885acea203410b1b113c68e4016d81b97` | Merged PR69; base-ui 0.5.0 with React/ReactDOM ^19 peers |
| omniview-plugin-kubernetes | `977e51e6bd51854fc7656b1eba96dce8c89d48c7` | Manifest ID `kubernetes`; runtime/Vite-plugin ^0.5.0, base-ui ^0.5.0, editors ^4.0.0; native pnpm 12.14.0 |

The original host checkout contains user-owned modifications and was not altered. New worktrees consume committed identities, not inherited dirty worktree contents. UI PR71 merged after this cohort was selected; its bounded layout acceptance is tracked separately and does not change the selected UI229a060 identity above. Release PR70 is not part of this acceptance.

## Isolation and tooling

All baseline bootstrap, probe and workspace lifecycle commands use one private empty HOME and an `env -i` allowlist: explicit tool PATH, HOME/TMPDIR, XDG directories, `GOWORK=off`, empty GOFLAGS, canonical native pnpm executable. No seed, kubeconfig, cloud credentials, agent socket or inherited plugin inventory is supplied. Private paths and supervisor state remain in the coordinator journal, not this portable receipt.

Observed tools: Go 1.26.1 darwin/arm64, Task 3.45.5, native pnpm 12.14.0 and standalone Node 24.14.0. The installed Homebrew Node 24.15.0 could not start because `libsimdjson.33.dylib` is absent (exit 134). An existing standalone Node 24.14.0 successfully returned its version under the clean environment and links only system libraries. No global installation or validation policy was changed.

The SDK-aware `GOWORK=off task --silent dev:cli:build` succeeded under the private environment. CLI help was inspected for actual init/create flags. Sources were registered explicitly and pinned before feature creation. Profile isolation is not a hostile-plugin sandbox or permission to access remote infrastructure.

Governing procedures: [P00 execution plan](../superpowers/plans/2026-10-17-resource-intelligence-baseline.md), [workspace operations](../development-workspaces.md), [package linking](../development-package-linking.md) and [worktree lifecycle](../development-worktree-lifecycle.md). The genuine protocol JSON SHA-256 is `a3e8e3914dfaca2e36cd3ae48f5bb184e17e07b69a804fbe9decd7fd19cc8ed5`; selected-source targets and file identities are separate managed `.local/links.json` evidence, not fields claimed to exist in the small protocol JSON.

## Executed protocol proof

Hostmod preparation initially refused an output directory lacking private permissions. Only newly owned probe directories were corrected to 0700; the same producer then ran successfully.

```sh
# Under the clean baseline environment, from the selected committed host:
go run ./scripts/hostmod/main.go --root "$HOST_SOURCE" \
  --sdk-source "$SELECTED_SDK" --output-directory "$PRIVATE_HOSTMOD"
# Copy returned mod/sum into the private probe module directory, per operational guide.
A11_PROTOCOL_PROBE=1 A11_PROTOCOL_REPORT="$PRIVATE_LINK_EVIDENCE" \
  go test -modfile="$PRIVATE_PROBE_MODFILE" -tags server \
  ./internal/devworkspace -run '^TestLinkPinnedProtocolProbe$' -count=1 -v
```

Result: PASS, package duration 10.774 s. Genuine producer receipt: `protocol=workspace`, `versions=[12.14.0]`, `atomicDist=true`, `peers=true`, `runtime=true`. Before/after export observations passed across host, UI, both disposable plugins and selected package roots. Deliberate stale-graph and incompatible-peer cases produced expected native refusals. This establishes the existing linking protocol, **not** actual application CSS cascade, browser singleton identity, Kubernetes codec behavior or selected-source runtime acceptance.

## Actual selected-cohort execution

Managed `workspace up` completed in 279.62 s. Inspection reported every selected build node ready, including bindings, runtime, Vite plugin, all three UI packages, host frontend/backend and Kubernetes frontend/backend. The supervisor log records Task-owned binding generation, runtime outputs before 32 generated shims, actual hostmod selection and the managed Kubernetes Unix-socket handshake. These identical build results are reused, not misrepresented as separate builds.

Both effective consumer queries returned SDK v0.6.0 replaced by the exact selected feature `plugin-sdk` directory:

```sh
# Same private environment, GOWORK=off and empty GOFLAGS:
# Host, using the actual supervisor-produced hostmod:
go list -modfile="$MANAGED_HOST_MODFILE" -m -json github.com/omniviewdev/plugin-sdk
# Kubernetes, using its managed worktree-local replacement:
go list -m -json github.com/omniviewdev/plugin-sdk
```

Actual browser inspection matched UUID and generation against the authenticated instance descriptor before actions. Kubernetes reached frontend `phase=ready`, no loader error or validation errors, route version 1. Its All Clusters tab rendered 0 clusters and “No Clusters Found / No kubeconfig contexts were detected” under the empty private HOME. No external cluster was selected.

From that real browser document, calling the shared runtime's `ResourceClient.LoadConnections('kubernetes')` returned `[]` in 2.9 ms. This is the actual Wails→host→managed resource-provider discovery path, not a fake response or direct-controller mock. The inspected selected implementation loads only configured kubeconfig files; the default `~/.kube/config` resolves into the empty private HOME. This single observation is not a latency budget.

To distinguish selected-source behavior from replacement metadata, temporarily instrumented the selected SDK's real `pkg/v1/resource/plugin/client.go:LoadConnections` and `server.go:LoadConnections` with distinct nonsecret diagnostic markers. Both actual consumers were rebuilt through controlled workspace lifecycle. A deliberate browser request returned `[]`; adjacent host-client and managed Kubernetes-server markers appeared in supervisor output, with server trace `abf12b805d7682d4e59ee44eaef6af34`. Startup markers were recorded separately and were not substituted for this deliberate request. The first host diagnostic used an unconfigured default logger and was not observable; a throwaway stderr marker supplied the actual host observation without changing request/response semantics.

After controlled shutdown, both diagnostic lines were removed. Original SHA-256 values matched exactly: client `c115df7ae5a8d80f0b84a8805ae30a8c67441c0c6aeb6d1d5e785af12850d42b`, server `0c73221d6cc83553d36f0b126c7c23e3bba79bdb17310011776699bbb593c802`. UI CSS was also restored to its original checksum. No instrumentation or experimental framework is part of the deliverable.

Actual plugin Vite transformed imports resolve to the selected host Vite-plugin shims. Importing those same shim URLs in the running browser proved strict identity equality with host shared exports for React `useState`, ReactDOM `createPortal`, runtime `PluginWindow` and base-ui `Button`. All four comparisons returned true. Host reported 32/32 shared exports. The actual document has one authoritative base-ui stylesheet, `ui/theme/base-ui.css`, whose selected source imports base-ui styles in `layer(base-ui)`; both host and plugin controls rendered with the host font. This verifies present-cohort sharing; the earlier pinned probe separately exercised live/atomic export replacement.

Actual selected-UI source observation: appended a temporary outline rule to selected base-ui `src/theme/styles.css` targeting the existing host home button and Kubernetes tab controls. The managed watcher built the marker into dist, but the existing browser and a manual document reload did not show it; **automatic CSS HMR is not certified** ([tracked separately in #118](https://github.com/omniviewdev/omniview/issues/118)). After controlled down/up, replacement browser boot identity matched the new inspected generation, Kubernetes was ready, and both actual controls had `rgb(21, 67, 109) solid 3px` outlines. This establishes rebuilt selected-source consumption, not hot-refresh success. The temporary rule was removed after controlled shutdown; source SHA-256 again matched `3d8761026ff5c01a6220ee79c35ae197d5c2acc348e068277c2afa3f807cc5f5`. Restored ordinary-surface recheck confirmed the marker absent on both actual controls.

Observed browser warnings: native/browser capability notice, React Router future flags, existing Kubernetes legacy sidebar/drawer exports and absent plugin-data array defaults. No application page exception was observed; the sole captured exception was an invalid selector injected by the coordinator's first browser-wait attempt. No warning was suppressed. Native WebView/MCP and resource acquisition from a real cluster were not exercised or claimed.

The supervisor also recorded failed marketplace requests to `api.omniview.dev` because DNS lookup failed. The profile smoke is credential/cluster-isolated, **not network-free**; no marketplace success is claimed.

## Settled verification

All commands used the private environment and selected feature sources:

| Consumer | Executed command | Result |
| --- | --- | --- |
| SDK | `go test ./pkg/v1/resource/... ./pkg/sdk ./pkg/interceptors -count=1` | All tested packages passed; resource 18.268 s, transport plugin 0.810 s |
| Kubernetes | `go test ./pkg/plugin/resource/... ./pkg/plugin/helm/... -count=1` | All tested packages passed; resource 0.599 s, resourcers 4.634 s, Helm 0.430 s |
| Host | `go test -modfile="$MANAGED_HOST_MODFILE" -tags server ./backend/pkg/plugin/resource/... -count=1` | Resource 1.421 s, graph 0.250 s, indexer 0.193 s, registry 0.217 s; all passed |

Host linking emitted existing macOS 27 versus deployment-target 11 linker warnings; tests still passed. No formatting, tidy or generation command was used as a substitute for these checks.

## Migration/removal ownership

Paths are repository-relative; directory rows include their exported entrypoints, generated consumers and behavior tests, not only the named illustrative symbol. Packet owners must migrate useful behavior, then delete superseded public paths before the compatible release.

| Observed surface | Cutover owner | Useful-workflow destination |
| --- | --- | --- |
| Host `backend/pkg/plugin/resource/{provider,adapter_v1,client_types,types,service,service_wrapper,controller}.go`: SDK-v1 aliases, Find/List and session dispatch | P45 provider/domain boundary; P03 canonical identity/cache; P47 old ABI retirement | Required catalog plus independently supported finite/source/Get and mutations; trusted P04 invocation/errors; no mandatory Find/CRUD |
| Host `backend/pkg/plugin/resource/{sink,emitter,subscriptions,connections}.go`, `indexer/`, `registry/` | P03 identity/cache; P05 source sessions; P07 schema; P47 retirement | Shared source lifecycle, canonical keys, authoritative catalog; preserve connection/status and useful sync visibility |
| Host resource `graph_service.go`, `graph_events.go`, `graph/`; runtime graph hooks | P03 identity inputs; P47 public ABI migration (P06/P22 later own graph behavior) | Preserve related-resource navigation without assuming namespace/GVK identity |
| SDK `pkg/v1/resource/{provider,interfaces,resourcer,resourcer_registry,controller,connection_manager,type_manager,types,types_schema,types_relationship,watch,watch_manager,session,config,discovery}.go`, `plugin/{client,server,convert}.go`, current resource/common/lifecycle IDL | P45 canonical domain/provider contract; P05 source wire; P07 catalog consumer; P47 legacy removal | Native enumeration/Get/query-only/read-only providers and optional updates; explicit errors, coverage, cancellation and cleanup |
| SDK older generation `pkg/resource/` (controller, services, types, transport), `pkg/sdk/plugin.go:RegisterResourcePlugin`, `pkg/sdk/{resource_opts,discovery_provider}.go` and associated registration/schema/layout metadata | P45 replace registration/provider contract; P05 acquisition lifecycle; P07 schema; P47 complete old-generation retirement | Migrate still-useful provider registrations and native implementations, remove old public controller/transport/options rather than preserve two universal resource APIs |
| Kubernetes `pkg/plugin/resource/register_v1.go`, `connection_provider.go`, `discovery_provider.go`, `connections.go`, `clients/`, `resourcers/`, `pkg/plugin/helm/`: GVK/GVR, namespace and raw native clients | P10 adapter migration; P07 schema inputs; P45 consumed SDK boundary | Keep Kubernetes optimizations in adapter, including Helm/actions; preserve logs/exec/metrics/network workflows |
| Runtime `src/hooks/resource/`: `useResources`, `useResourceSearch`, `useResource`, mutations/actions, type/group/schema, event batching, watch/sync and graph hooks | P15 thin query client/cache; P03 keys; P07 catalog; P47 exports | Host-prepared membership/order/windows and bounded keyed frame application, not reconstructed full inventory or client query engine |
| Runtime `src/utils/{resourceKey,activeSyncAggregator}.ts`, `src/compat/`, `src/{api,models,runtime,index}.ts`, resource/graph/metric generated bindings | P03 identity; P15 client migration; P47 compatibility/public ABI removal | Exact opaque identity, intentional public API and regenerated DTOs; bindings only through Task |
| Host `ui/components/tables/Resources/ResourceTableContainer.tsx`, `ui/pages/[plugin]/[connectionID]/resources/ResourceTableView.tsx`, `ui/hooks/resource/`, `ui/federation/LinkedResourceDrawer.tsx` | P15 query consumption; P26 renderer registry; P47 ABI | Preserve current resource view, useful columns/actions/inspection and links; move namespace filtering/order ownership out of generic core |
| Host `ui/providers/RightDrawerProvider.tsx`, `ui/features/connectionState/` and their resource Get/Update, watch-summary and retry callers | P03 canonical addresses; P15 resource/read-cache usage; P26 drawer registry; P47 old API retirement | Preserve linked inspection/edit workflows and truthful connection/resource progress without mandatory watch assumptions |
| Runtime `src/extensions/`, `src/types/{extensions,app,homepage,plugin}.ts`; host `ui/features/extensions/resource/`, `ui/features/plugins/core/{PluginService,normalization,validation,types}.ts`; Kubernetes entry legacy sidebars/drawers | P26 current-registry cutover; P47 legacy contribution retirement | Preserve useful renderers/drawers and navigation via current extension registrations, no permanent alias layer |
| Kubernetes `ui/src/` resource callers, generated/compat models, routes/pages, table/sidebar/drawer contributions, Helm views (including `components/helm/repos/RepoSidebar.tsx`) and homepage `ConnectedClusterCard.tsx` Pod/Event/Node/Deployment queries | P10 native adapter coordination; P15 runtime caller cutover; P26 contributions; P47 old frontend ABI retirement | Preserve cluster overview, Helm repositories/releases/charts, resource tables, details/actions and navigation; replace `metadata.uid`/GVK/namespace assumptions at public core boundaries while retaining Kubernetes-native adapter data |
| Host `ui/features/plugins/api/shared_dependencies.ts`, `packages/omniviewdev-vite-plugin/src/sharedPackages.ts`, shim generator and package exports; release metadata/workflows | P47 shared/runtime ABI; P45 provider protocol; coordinated P46 admission/release gate | Coherent React/runtime/UI identities and explicit incompatible-plugin refusal; no automatic release/tag authorized here |
| Runtime `src/hooks/{logs,exec,networker,metric,settings,connection}/`, contexts/router; host corresponding plugin services | P47 public caller migration with P03/P45 identity/domain inputs | Preserve logs, terminals/exec, metrics, port forwards, settings, connections and navigation; no compatibility shim merely to avoid migration |

## Acceptance review and disposition

Independent review accepted the expanded removal inventory, evidence references, paired real-process SDK observation and restart-based UI source-consumption scope. All experimental source bytes were restored before the final managed relaunch.

Restored-source launch completed in 143.59 s. Browser boot identity matched inspected replacement generation; the ordinary real discovery request again returned `[]`, Kubernetes reached frontend ready, and both host/plugin control outlines returned to original `none` values. The browser tab was closed. Controlled `workspace down` succeeded under the same private HOME/environment. No foreign process was killed; profiles, owned branches and private evidence remain retained, without force cleanup or state deletion.

Final independent review accepted P00/C00 with no remaining Critical, Important or Minor findings requiring changes. This receipt establishes the browser-mode selected-cohort baseline, not production resource-query contracts, automatic CSS HMR, native WebView/MCP, credentials/hostile-plugin sandboxing, marketplace availability or real-cluster acquisition. P44/P04/P18 are the next eligible independent packets after remote predecessor reconciliation; no later contract is inferred frozen.
