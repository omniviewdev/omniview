# Dev CLI friction: issue plan and audit

## Scope and authority

Source: `~/Notes/omniview/omniview-dev-plugin.md`, including the appended release outcomes. Audit baseline: host `e1fd7d7d44bbb312867b3d394341a34916fdf5c2`. This is not an audit of the older canonical feature checkout.

Managed collection: `/Users/joshuapare/Repos/omniviewdev/workspaces`.

- Issue workspace: `dev-cli-friction-audit-20261031`, UUID `51f73a51-1911-4d73-ae94-44fb754884c7`.
- Independent velocity workspace: `dev-cli-build-speed-20261031`, UUID `0d1a3c74-caa9-4f98-bd80-98f613fb675f`.
- Both explicitly select SDK `5d0cc3dac81138ea87da1f94322873dde07aa9f2`, the independently reviewed revision recorded in the notes. No collection default or approval authority is changed.

Do not treat a managed profile as a sandbox. Preserve real protocol reports, reviewed SDK ancestry, protected-source checks, exact generated-output ownership, clean-worktree checks, and fast-forward-only edits. No user profile, existing feature workspace, branch, or cluster is cleaned up by this work.

## Filed issue disposition and acceptance plan

| Finding | Current evidence and decision | Next acceptance gate |
| --- | --- | --- |
| 1. Collection discovery | Added read-only `workspace collections` using registered Git worktrees and validated matching host registries. No global index or automatic profile selection. | Actual canonical-checkout smoke found 13 collections including the requested root; `workspace list` still refused without explicit collection context. Orphaned/unavailable collections require explicit context. |
| 2. Creation hides launch prerequisites | Source-only creation remains valid. Existing `workspace preflight` aggregates missing inputs. Tighten `create --start` before materializing worktrees; see setup audit. | Invalid launch inputs leave no new workspace/profile; source-only create still works. |
| 3. Stale registered SDK default | Added direct SDK import/source-presence preflight before installers. Explicit pins avoid the stale collection default; no version guessing or module download occurs. | Missing packages refuse with consumer/import/selected SDK; ordinary source additions pass. Full symbol/API, target-specific buildability and future generation remain compiler boundaries. |
| 4. Failed supervisor recovery | Failed supervisors intentionally retain output/process ownership. `edit --apply`, `refresh`, and journaled `recover` already exist. Recovery hints emitted by build/status paths lacked collection context. Change hints to quote the absolute manifest target; do not kill/adopt failed owners. | Copy a recovery hint from outside the collection, including paths with spaces/apostrophes. Resolve the exact workspace without a root fallback. Retain authenticated failed owner until explicit recovery. |
| 5. Reviewed SDK baseline | Preserve ancestry and isolation-source checks. The noted release used a newer approved full revision than older documentation. Do not promote current SDK HEAD to reviewed authority. | Report selected and reviewed commits on refusal; retain refusal for unrelated histories, even when trees match. |
| 6. Auxiliary preview ownership | Notes do not prove which writer changed `node_modules`. Current docs say unmanaged commands may invalidate receipts. Do not label Storybook itself guilty or adopt changed bytes. | Reproduce preview and token generation independently; compare producer-ledger paths before/after. Design a managed preview command with explicit outputs and supervisor-owned lifetime before permitting mutable cache exclusions. |
| 7. Reset/unlink/down recovery chain | Current `reset-modules` help distinguishes reinstall from cleanup-only during interrupted unlink/remove. `RecoverLinks` preserves changed manifests before retiring overlays; `Recover` now has terminal proof and idempotent completion. The notes confirm recovery once succeeded in 157 seconds, not that all interruption points are solved. | Inject interruption at reset, unlink, install, and restart boundaries. Repeat `recover` without a second install/restart. Unknown dependency bytes must still require explicit reset/reconciliation. |
| Documentation-only edits mark served source stale | `checkoutStatuses` hashes commit, all tracked changes, and all untracked nonignored files. `observeStatus` compares complete checkout records. Thus non-runtime files participate by design; changing this requires a runtime-input contract. | Define served-runtime inputs from the build/watch graph, then distinguish checkout dirtiness from runtime freshness. Unknown input paths must remain conservative. Do not add a broad docs exemption: bundlers can import text. |
| Cohort approval drift | Existing canonical candidate admission already runs before expensive preparation. Mismatch diagnostics now report checked-in and independently approved full commits; invalid authority input is not echoed. | Actual script smoke accepted the repository approval value, rejected a controlled stale value, and redacted invalid input. No approval variable was changed. |
| Resource lease after restart | The notes explicitly leave host/plugin/browser cause unresolved. CLI authenticated readiness does not prove frontend resource leases were refreshed. | Trace generation/lease identities across one source restart and one actual resource route. Keep investigation separate from compiler/readiness status. |
| Divergent SDK release-tag ancestry | Equivalent trees do not prove reviewed ancestry. Fast-forward-only edits correctly reject divergent histories. Pre-materialization trust validation avoids creating an unusable `--start` workspace. | Exercise divergent selected/reviewed histories and verify no worktree/profile publication. An explicit recreate design must refuse dirty source and preserve state; no reset-based repair. |
| Marketplace backend archive admission | Managed artifact admission needs independent fixed-SDK evidence; protocol evidence is not artifact provenance. Install command help now states this limitation before execution. | Source-build-only managed acceptance is documented. A future importer still needs independently authenticated archive/build/SDK provenance; no checksum/tag-based bypass was added. |

## Audit order

1. Setup and source trust: cheap pre-materialization checks, actionable diagnostics, explicit refs, immutable authority. See `dev-cli-setup-audit-20261031.md`.
2. Recovery targeting: make every emitted recovery command self-contained; retain process and output ownership semantics.
3. Recovery state transitions: reuse existing journals and terminal recovery proof; exercise interruption cases before changing cleanup behavior.
4. Output writers: isolate auxiliary preview/cache changes with exact producer receipts; no blanket `node_modules` exclusions.
5. Freshness and resource leases: separate checkout evidence, served inputs, authenticated host generation, and actual browser execution.
6. Release acceptance: source-cohort authority and artifact provenance are separate contracts, not convenience flags.

### Lock diagnostics

`journal.go:tryLock` currently returns only `workspace_busy` when flock acquisition fails. A useful follow-on must report lock role and exact workspace inspection/recovery target. Any owner metadata must bind the recorded native process identity, workspace UUID, operation and generation; a stale PID or lock file is not kill authority. Publish advisory owner metadata only while holding the real lock, and label concurrent handoffs as observations rather than ownership proof. Test a live contender, exited owner, stale metadata and generation replacement before adding automatic recovery.

## Separate build-speed work

See `dev-cli-build-speed-audit-20261031.md` in the independent velocity workspace. Existing parallel scheduling, package/bindings/host reuse, and profiling must be considered before adding another cache. Compare real warm commands, not only fixture timings. Never trade fail-closed receipts or source/toolchain invalidation for speed.

## Verification

`GOWORK=off go test ./internal/devworkspace ./cmd/omniview-dev -count=1` passed both complete packages: 387.983 seconds and 88.645 seconds respectively. Separate read-only reviews of setup/recovery and build-speed changes returned no findings.

Actual patched CLI refusal cases ran from the canonical checkout, outside the collection:

| Requested `create --start` input | Observed result | Materialized workspace |
| --- | --- | --- |
| Nonexistent protocol report | exit 3, `link_evidence_required` | No |
| No selected SDK repository | exit 2, `sdk_source_required` | No |
| SDK `v0.10.0` with reviewed `5d0cc3d…` | exit 4, `sdk_source_untrusted`, both full commit IDs reported | No |

The selected release tag actually resolved to `d12a185a53b23996e64598886a5ea3b9331e9d88`; its ancestry refusal remained intact. Initial source-only creation of both audit workspaces succeeded without `--start`. Read-only preflight of the issue workspace with the existing actual protocol receipt returned `ready: true`.

The actual host-only browser launch reached authenticated readiness, current dependencies and served source, and connected HMR in 136.84 seconds. The host browser endpoint returned the Omniview HTML document. This is not a claim of native-window or plugin acceptance.

For recovery verification, an integration-owned temporary Go file referenced an undefined symbol. Patched `workspace up` failed at `host-backend` with the real compiler diagnostic and exit 5. Inspection retained the failed owner and emitted:

```sh
'omniview-dev' 'workspace' 'refresh' '--workspace' '/Users/joshuapare/Repos/omniviewdev/workspaces/workspaces/dev-cli-friction-audit-20261031/workspace.json'
```

After removing the temporary fault, the emitted command ran from the canonical checkout with the patched CLI on PATH. It completed in 84.61 seconds and returned `launchPhase: ready`, authenticated readiness, current dependencies and served source, and connected HMR. Native `workspace down` then stopped the owned instance. Temporary fault/probe source files were removed. No existing feature workspace or default desktop profile was stopped.

The issue table distinguishes reported observations, implemented fixes and planned acceptance. Full source/API compatibility, auxiliary-preview ownership, lease refresh and release-provenance admission remain separate contracts; no trust gate was weakened to claim these solved.

### Implementation and publication checks

The extended CLI implementation passed `GOWORK=off go test ./internal/devworkspace ./cmd/omniview-dev -count=1`: 334.091 seconds and 56.133 seconds respectively. Canonical cohort admission tests also passed all seven cases. The later error-transport correction was additionally exercised through the actual supervised CLI; final remote checks cover the published commit.

Actual `workspace collections --json` from the canonical checkout discovered 13 validated roots including the requested collection. `workspace list --json` from the same directory still returned exit 3, `missing_registry`, proving discovery did not implicitly choose a collection.

A disposable host source file imported a missing SDK package. Actual `workspace up` returned `sdk_contract_mismatch` without changing the existing link receipt. This smoke exposed that supervisor transport reconstructed the exit as 5 rather than the original 3. The error mapping now preserves dependency-contract exit 3; the corrected actual CLI returned exit 3 for the same controlled failure.

Adding an ordinary uncommitted, non-isolation SDK source package satisfied that import. A real launch then reached authenticated readiness, current dependencies/served source and connected HMR in 56.25 seconds, with SDK checkout explicitly reported dirty. Native `workspace down` stopped the owned instance. Both disposable source files and the SDK smoke directory were removed.

Actual install-version and install-archive help, invoked without a selected instance, explained the fixed-SDK evidence requirement and supported source-build path. No artifact importer or admission bypass was introduced.

Repository approval authority was read independently before publication. It now equals candidate SDK `d12a185a53b23996e64598886a5ea3b9331e9d88`; the earlier local workspace selection remains explicitly reviewed `5d0cc3d…`. Canonical candidate admission accepted the actual repository authority, rejected a controlled stale authority while reporting both full commits, and withheld an invalid authority value from diagnostics. Neither approval variable nor source-cohort pins were changed by this patch.

### Review corrections and cross-version smoke

CodeRabbit's review identified six follow-ups. Registry loading now takes the caller context throughout source Git validation, with every call site migrated and no old overload. Discovery cannot suppress cancellation as an empty successful listing. Tests gate real Git source-resolution and origin-validation subprocesses rather than sleeping or mocking context forwarding.

Manager status now renders recovery guidance from the selected workspace identity before applying retained journal-specific recovery. It does not parse, append to, or execute an opaque command saved by an older supervisor. An actual baseline CLI launched a controlled compiler failure and reported a bare UUID recovery hint. The updated CLI inspected that same authenticated generation, rendered an absolute manifest hint, and refused replacement with the corrected command. Executing that command outside the collection replaced the failed owner and reached authenticated readiness, current dependencies/source and connected HMR in 86.12 seconds.

The SDK import scan now includes ordinary Go packages named `build`, `bin`, `dist` and `shims`; the watcher's exclusions are unchanged. An actual missing import under `build/devcli_review_smoke` returned exit 3 before installation, with the link receipt byte-for-byte unchanged. Package-directory links, Go-source links and special Go files refuse rather than silently bypass scanning. Ordinary non-Go asset links remain supported after metadata inspection; their content is not opened. A real linked-directory smoke was refused even earlier by the existing composition gate, also without changing the link receipt; it is not claimed as execution of the later import-scanner branch.

Install help now includes an explicit absolute manifest target. Candidate mismatch diagnostics name both `REVIEWED_SDK_REVISION` for direct execution and the repository variable mapped by CI, without recommending an approval bypass. Actual help, candidate mismatch, collection discovery and cross-version recovery paths were exercised. All temporary source, directories and links were removed, and the owned workspace was stopped.
