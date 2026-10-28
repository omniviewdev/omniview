# Resource History — independent prerequisite execution

Date: 2026-10-28.
Status: **independent prerequisites exercised; full Resource History is blocked and not implemented**.

Inputs: [architecture](2026-10-27-historical-resource-context.md), [work packets](2026-10-27-historical-resource-context-work-packages.md), and [draft contract handoff](../superpowers/specs/2026-10-28-history-contract-handoff.md).

## Scope and release boundary

The user authorized workspace implementation and reviewed admin merges. That authorization does not replace the existing safe-query dependency or approve an alternate evaluator, duplicate identity, temporary CEL fork, or a guessed public history wire. This delivery contains independently useful local audit fixture tooling, a standalone storage-driver experiment, and reviewable contract work. It does not install a timeline, production history provider, durable application evidence index, EKS follower, investigation UI, or AI tool.

HR00 now has actual browser/source-cohort evidence below; the full packet is not declared accepted by this receipt alone. HR01/HR03/HR04 remain design-only. HR02 has partial driver evidence, not an accepted encryption/platform/access policy. HR05 and production query/runtime consumers remain gated.

## Isolated workspace and selected sources

Implementation workspace: `resource-history`, UUID `63787843-d494-4599-a977-d38284ee7d9d`. Dedicated collection: `historical-resource-context-20261028`. Host/Kubernetes edits use isolated Git worktrees, not the original main checkouts. The two authored planning files remain untouched in the original checkout and were copied into the feature worktree.

| Source | Selected committed identity | Observation |
| --- | --- | --- |
| Host | `e4d4a31e0327519870bd9a4d3865dea5b61c26c7` | Runtime package 0.7.4; selected CLI rebuilt from this source |
| SDK | `5b3ef764d1cf738835a723a749a0cb6c45f85e44` | Explicit reviewed v0.7.0 source |
| Kubernetes | `e532c9504b95c9f50ea17c891c4a709efa0756ba` | Selected committed plugin ID `kubernetes` |
| UI initial selection | `11a55a53acb67328f743c512757cabd29135f5fc` | base-ui 0.7.1; initial older-CLI launch rejected benchmark comparison dependencies |

Launch attempts use a dedicated empty HOME, private development state, explicit native pnpm 12.14.0 and SDK revision. They do not load the user's kubeconfig or cloud credentials. Local Docker fixture operations use an explicit private kubeconfig and only the fixture-created cluster.

The first launch used a CLI built from the original host checkout, which was seven commits behind selected origin/main. Its UI-source preflight rejected benchmark-only Emotion dependencies. Source selection was then changed through managed lifecycle to published UI packages. A symlinked pnpm path was rejected and corrected to the canonical native executable. A subsequent strict recursive peer audit found Kubernetes resolving base-ui 0.7.0 while runtime 0.7.4 requires ~0.7.1. No peer check or preflight was disabled.

The older failed install left a recorded dependency transaction. Controlled down/unlink detected an unverified generated root lockfile; selected-source recovery preserved/retried it but the incompatible published-package audit still failed. No user source or dependency policy was reset to hide those failures. A separate clean runtime-baseline workspace with selected UI source is used for further application acceptance rather than treating this failed launch as success.

### Successful clean runtime cohort

The selected-source CLI created and launched `resource-history-runtime`, UUID `1b1bc658-0c94-4392-9c3f-26aba6145d1c`, in 248.20 seconds. It selected the same host/SDK/UI commits above and newer Kubernetes main `9bfa03d35cc87a0b94ca0c68280f53ec7d5967aa` (version 0.7.1). The original implementation workspace was not reset; its interrupted installer evidence remains preserved separately.

Actual observations:

- Managed launch reported `launchPhase=ready`, `phase=complete`; host, Kubernetes build/Vite/RPC/controller stages ready.
- Both effective Go consumers resolved their declared SDK v0.7.1 requirement to the explicit selected local v0.7.0 source commit `5b3ef764d1cf738835a723a749a0cb6c45f85e44`. Host query used the supervisor-produced host.mod; Kubernetes query used its managed local replacement. Versions alone are not treated as source reachability.
- Browser main-realm frozen identity matched the authenticated descriptor's UUID and generation `d557f116-cb1a-4fcf-90cd-6e28e44b0b47`.
- Actual Kubernetes frontend reached `phase=ready`, no validation errors, and rendered “No Clusters Found” under the empty private HOME.
- A deliberate browser call through shared `ResourceClient.LoadConnections('kubernetes')` returned `[]` through the actual Wails/host/provider path.
- Importing actual plugin-server shim modules and comparing against host shared exports returned strict identity equality for React `useState`, ReactDOM `createPortal`, runtime `PluginWindow`, and base-ui `Button`. Host published 32 shared module entries.
- Visual screenshot confirmed the development profile badge and rendered Kubernetes empty-state surface. Browser diagnostics included an aborted HEAD request for `/wails/custom.js`; no application page exception was observed.

The first browser evaluation used an isolated evaluation realm and incorrectly saw no application globals. Explicit main-realm evaluation established the real boot/plugin state; no application code was changed to manufacture it. Native desktop, automatic HMR, credentials, real-cluster resource ingestion, history UI and full HR00 technical acceptance are not inferred from this baseline.

The browser tab was closed and the owned runtime supervisor was stopped through managed lifecycle after these observations. No foreign process or user profile was stopped.

## Confirmed production blocker

Current [P01 issue80](https://github.com/omniviewdev/omniview/issues/80) and [P45 SDK issue12](https://github.com/omniviewdev/plugin-sdk/issues/12) remain open/blocked. Source inspection found the known precision faults still present in both paths in official CEL v0.33.1:

- Release commit `fd8eb2343c6a4294575aef95a9ad03f82b5ba6ca`: [mixed comparison](https://github.com/cel-expr/cel-go/blob/fd8eb2343c6a4294575aef95a9ad03f82b5ba6ca/common/types/compare.go) and [optimized membership](https://github.com/cel-expr/cel-go/blob/fd8eb2343c6a4294575aef95a9ad03f82b5ba6ca/interpreter/decorators.go).
- Inspected master `33ed08696f95d5a4088196198f63fcafe4cdc24a` retains the same precision issue.
- [PR1377](https://github.com/cel-expr/cel-go/pull/1377), head `7d2d5e7d1203562205788c1a45392e1e86c645d3`, remains unmerged and does not include the optimized-membership correction.

Known failing checks were not rerun merely to confirm these unchanged faults. No production dependency was upgraded. Unblocking requires an admitted correction covering both paths and the existing actual-pin conformance/review; a temporary patch still needs explicit separate authorization.

## Real Kubernetes audit fixture

Kubernetes repository adds `hack/history-audit.mjs`, behavioral `node:test` cases, and usage documentation. No host history API is introduced.

The fixture pins kind v0.27.0 and `kindest/node:v1.32.2@sha256:f226345927d7e348497136874b6d207e0b32cc52154ad8323129352923a3142f`. It creates a distinct random-name single-node sandbox, private kubeconfig, and host-mounted audit directory. Ownership guards verify cluster/container/mount identity before destructive operations. Docker Desktop's exact `/host_mnt` translation is accepted only on Darwin; unrelated paths remain rejected.

The audit policy records RequestResponse only for selected writes in the fixture namespace; Secrets, service-account token, authentication and authorization endpoints stay Metadata. Commands never invoke an arbitrary shell. Subprocess execution, Kubernetes requests, creation and deletion are bounded.

Executed:

```sh
node --test hack/history-audit.test.mjs
node hack/history-audit.mjs create "$PRIVATE_SANDBOX"
node hack/history-audit.mjs exercise "$PRIVATE_SANDBOX"
node hack/history-audit.mjs inspect "$PRIVATE_SANDBOX"
node hack/history-audit.mjs delete "$PRIVATE_SANDBOX"
```

A private kind v0.27.0 executable was installed outside the repository; the globally installed kind v0.30.0 was not replaced. Client kubectl v1.33.0 exercised the pinned local API server.

Observed final scenario: 16 namespace-qualified audit records, all at ResponseComplete, among the active file's background metadata records. The full file continued growing; its total is an observation, not a stable completeness count.

Assertions passed for:

- ConfigMap create and patch, deletion, and recreation with distinct actual UIDs.
- A recorded 403 impersonated denial and a server-side dry-run request.
- Kubernetes Event creation.
- Custom resource creation and a successful status-subresource patch.
- Synthetic Secret and TokenReview body sentinels absent from the raw audit log.
- Body-bearing records restricted to the configured namespace/resource/verb allowlist.

The first real smoke exposed Docker Desktop mount translation and lowercase kubectl `forbidden` output. Both were corrected; ownership tests and the full fresh-sandbox lifecycle then passed. Seven fixture behavior tests passed; after integrating concurrent main documentation/icon changes in a separate clean managed workspace, all 12 `hack/*.test.mjs` tests passed. Independent review found no remaining merge blocker in the fixture scope.

Both fixture-created clusters were removed through their owned delete command. Private raw logs, owner receipts and kubeconfigs remain outside Git; they must not be published. The inspector reads the active bounded audit file only, not a complete rotated archive. This is fixture/corpus evidence, not HR08 canonical normalization or host ingestion acceptance.

Kubernetes [PR40](https://github.com/omniviewdev/omniview-plugin-kubernetes/pull/40) was admin-squash-merged at `32968cc8a5d8fe691a08fae7072d2bf43eef3bad`. Main's concurrent icon documentation was preserved. No CI workflow checks were reported for this file scope; the CodeRabbit check was neutral/rate-limited. Merge relied on the explicit real smoke, passing behavior tests, independent review, clean merge state and pinned reviewed head—not a claim that absent CI ran.

## SQLite driver experiment

Retained source: [`bench/historystorageprobe`](../../bench/historystorageprobe/README.md), an independent Go module. Root host dependencies do not change. The module pins modernc.org/sqlite v1.61.0 and uses only synthetic records.

Actual file-backed execution passed on Darwin ARM64 and Linux AMD64 in Docker on the ARM workstation. Linux may run through Docker emulation; this is not a claim of native x86 hardware performance. Both report SQLite 3.54.1, WAL, FULL synchronous mode and FTS5.

Proofs include Unicode token controls, FTS-versus-substring distinction, equal-time keyset paging, concurrent WAL reader stability, evidence/checkpoint rollback before child exit and retention after committed child exit, private Unix DB/WAL/SHM modes, SQLITE_FULL under a page quota without checkpoint advancement, and SQLITE_NOTADB without replacing corrupt input. `go vet ./...` passed for this standalone module.

| Target | Build | Actual execution | Standalone binary bytes |
| --- | --- | --- | ---: |
| darwin/arm64 | Passed, CGO disabled | Passed on workstation | 10,289,970 |
| darwin/amd64 | Passed, CGO disabled | Not exercised | 10,484,064 |
| linux/amd64 | Passed, CGO disabled | Passed in Docker | 10,666,825 |
| windows/amd64 | Passed, CGO disabled | Not exercised | 10,699,264 |

These are standalone executable sizes, not desktop bundle-size deltas. A single 10,000-row transaction took 19 ms on the final Darwin run and 102 ms in the final Docker run; neither is an ingestion SLO, and those timed rows are not all FTS-indexed.

A throwaway comparison using the same synthetic operations passed on Darwin ARM64 with github.com/mattn/go-sqlite3 v1.14.52, CGO enabled, and `sqlite_fts5`. It reported SQLite 3.53.4, an 8,013,794-byte executable, and 8 ms for the same timed transaction. Driver/SQLite versions differ, and single runs do not establish an apples-to-apples performance winner. This comparison does not add a host dependency or approve CGO toolchains on every release platform.

Storage recommendation remains provisional: modernc provides a useful no-CGO candidate; mattn requires explicit FTS5 build tags and C-toolchain acceptance. Ordinary SQLite is not encrypted. Neither experiment proves `os.Root` sidecar containment, Windows ACLs, encryption/key lifecycle, upstream authorization/revocation, production redaction, real OS disk-full, power-loss safety, production schema migrations, or full HR02 acceptance.

## Review and next handoff

Independent review found no actionable contradiction in the draft contract/backlog and execution claims, while explicitly preserving their unfrozen status. A separate storage-probe review found no merge blockers in its verification-only scope. These reviews do not approve a production ABI, storage security profile or all HC gate acceptance. Remaining work is tracked in [host issue175](https://github.com/omniviewdev/omniview/issues/175).

Next eligible work remains reviewing HR00's recorded source-cohort acceptance, HC01 canonical-domain review with the RI owner, HR02 security/platform policy, and HC03–HC07 review. Production history transport/query/UI remains blocked until those handoffs exist. No compatibility shim or partial history feature is released to bypass them.
