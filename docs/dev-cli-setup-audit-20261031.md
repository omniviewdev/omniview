# Dev CLI setup audit — 2026-10-31

## Scope and evidence

This audit covers setup issues 1, 2, 3 and 5 in `~/Notes/omniview/omniview-dev-plugin.md`, including its release follow-up. The appended observations are retained as reported evidence, not represented as new local execution. Integration verification subsequently exercised the patched CLI and complete affected Go packages; see [the verification record](dev-cli-friction-plan-20261031.md#verification). LSP references were checked during integration, with an incomplete cross-package reference result reported to tool QA. No independent approval review, approval-variable change or canonical-checkout mutation was performed.

## Findings and changes

### 1. Collection discovery

`workspaceCollectionRoot` in `cmd/omniview-dev/workspace_commands.go` searches explicit context and enclosing collection context. Outside a collection it returns `missing_registry` with an explicit `--root COLLECTION` instruction. There is no cross-collection chooser. This refusal is correct: silently choosing a sibling collection could select another profile.

Added read-only `workspace collections` discovery from the selected host Git repository's registered worktrees. It validates reachable matching collection registries, rejects redirected markers and never scans siblings, creates a new authority index, fetches refs or selects a profile. Actual canonical-checkout execution returned 13 collection roots including the requested one; `workspace list` still refused without explicit collection context. Invalid/unavailable registries are omitted rather than adopted. Collections without a registered host worktree remain selectable only through explicit `--root`.

### 2. Creation versus launch prerequisites

Source-only creation is intentional and remains valid. Existing `workspace preflight` aggregates missing protocol evidence, reviewed revision and SDK selection without starting tools. Existing `workspace evidence` supports retaining real protocol receipts; CLI option loading already supports the collection receipt at `.omniview-dev/link-protocol.json`. These mechanisms partly address the original notes; no receipt or approval should be inferred from a successful unrelated workspace.

Previously, `create --start` checked only `LaunchOptions.Validate` before `Manager.Create`. The SDK selection and protocol receipt were checked later, after materialization. The command now parses explicit or collection-level launch evidence before Create, validates it using `PreflightLaunch`, and requires `--repo plugin-sdk` before materialization. `Manager.PreflightCreateLaunch` uses the same source planner as creation and checks selected SDK ancestry before Create. Bad evidence and divergent ancestry must leave no workspace directory or feature branches. Actual launch retains all existing trust and ownership gates.

Remaining limit: this is an input/ancestry preflight, not an atomic reservation of source refs. Source planning can fetch selected refs; it does not create feature worktrees, branches, profile state or durable creation intent. A ref can advance between preflight and creation. Runtime verification still checks actual selected source and must refuse if trust changes. Broader source compatibility and isolation-byte checks can still fail after materialization; this change does not promise transaction rollback of every failed launch.

### 3. Stale SDK defaults and source/API compatibility

`internal/devworkspace/runtime_preflight.go` checks SDK module identity, reviewed source verification, host/plugin SDK module declarations and runtime/UI contracts before link installation. It now also parses direct SDK imports in the selected host/plugin Go roots and checks the selected SDK worktree for non-test package source. The recorded missing `pkg/resource/v2` fails before installers or builds with the consumer, import and selected SDK path, plus advice to explicitly select a compatible SDK ref. Ordinary uncommitted SDK source additions remain valid; no version-string comparison, module download or installation is used.

The new creation check rejects a stale source when it does not descend from the explicitly reviewed revision. That is a trust check, not a replacement for compatibility analysis. Trust failures now report the selected ref, selected commit and reviewed commit. Runtime trust failures report actual SDK HEAD where available rather than silently using the manifest's original base commit.

The import scan includes tests and all platform/build-tag variants conservatively, including ordinary Go packages under build, bin, dist and shims. SDK presence accepts non-test regular Go files with a valid non-main package clause for any platform/tag, including generated source already present. The scan skips nested consumer modules, nested SDK modules, Go-ignored dot/underscore directories and files, testdata, vendor, node_modules, coverage and storybook-static. Excluded managed directories may themselves be symlinks. Other consumer directory symlinks, Go source symlinks, indeterminate links, and symlinks in the selected SDK package path or source files fail closed with a path-specific repair diagnostic. Ordinary non-Go asset symlinks remain accepted after target metadata inspection; the scan does not walk or read external targets. Non-regular Go source files are refused before parsing. Comments and strings are not imports. This is a source-presence check, not proof that files build for the current target, that generation will succeed, or that exported symbols/APIs match. Compilation remains authoritative for those boundaries. A resolved source-cohort diagnostic containing every selected ref/commit, consumer SDK requirements and separately supplied approval authority remains separate work. Do not change registered defaults without independently reviewed cohort authority.

### 5. Isolation baseline changes

`devsource.VerifyWithOptions` requires a full reviewed commit, required ancestry and protected isolation file checks. Those protections remain unchanged. Explicit per-workspace isolation development remains opt-in, not a setup fallback. Source equality, a branch called main, a remembered note or an automated heuristic cannot establish independent approval.

The selected reviewed source for this audit workspace is `5d0cc3dac81138ea87da1f94322873dde07aa9f2`, supplied by the parent task's existing authority. This audit does not approve that commit for other collections or change repository approval variables. Planned work: record reviewed authority alongside a maintained source cohort with provenance and refresh policy, and diagnose mismatching candidate pins before expensive preparation. Acceptance: stale authority reports both exact commits; an unreviewed isolation delta still fails.

## Divergent release ancestry

The notes report SDK `v0.10.0` resolving to `d12a185a53b23996e64598886a5ea3b9331e9d88`, while independently reviewed source is `5d0cc3dac81138ea87da1f94322873dde07aa9f2`. Reported tree equality is not ancestry proof and was not re-queried here. The existing gate must reject divergence, even when bytes match. The new creation preflight checks `git merge-base --is-ancestor REVIEWED SELECTED` against resolved commit IDs before materialization and reports both IDs on failure.

Do not rewrite an owned branch to repair divergent history. Existing non-fast-forward edit safeguards remain authoritative. For a newly created, empty failed workspace, inspect it, stop it, and explicitly remove only its owned state/branches before recreating with an independently approved descendant. Never automate that destructive sequence merely because launch failed. Future release process work must preserve reviewed ancestry when cutting tags; any alternate provenance admission needs separate independent authority and design review.

## Release-artifact acceptance limitation

`internal/instance/artifact.go` requires host-owned fixed-SDK artifact evidence. `internal/devworkspace/buildgraph.go` records evidence after trusted source builds. A marketplace archive digest or release checksum alone cannot establish which reviewed SDK source built its backend. The notes report marketplace installation refusing an archive without this independent evidence; this is not proof that ordinary desktop installation fails.

The supported managed-profile path is to select the released plugin source and rebuild against the selected verified SDK:

```sh
omniview-dev workspace edit WORKSPACE --root COLLECTION --add-plugin kubernetes --ref kubernetes=v0.11.0 --apply --json
```

This verifies a source-built backend, not execution of the marketplace backend archive. `workspace evidence` handles protocol receipts, not release-artifact provenance. No provenance importer, fabricated evidence, approval bypass or normal-profile execution was added. Planned work: surface this source-build-only limitation before managed-profile marketplace installation. A future release-artifact workflow requires an independently authenticated builder/provenance authority, archive-to-build digest binding, SDK source identity and revocation policy. Until that authority exists, direct managed marketplace archive execution remains unverified.

## Acceptance and commands for integration owner

Run after all integrated edits land, from this workspace's host directory:

```sh
gofmt -w cmd/omniview-dev/workspace_commands.go cmd/omniview-dev/workspace_preflight_test.go internal/devworkspace/create_preflight.go internal/devworkspace/create_preflight_test.go internal/devworkspace/runtime_preflight.go
GOWORK=off go test ./cmd/omniview-dev -run TestWorkspacePreflightAggregatesMissingInputsAfterSourceOnlyCreation -count=1
GOWORK=off go test ./internal/devworkspace -run 'TestCreateLaunchPreflight|TestLaunchPreflight' -count=1
GOWORK=off go build -o /tmp/omniview-dev-setup-audit ./cmd/omniview-dev
```

Regression fixtures use synthetic protocol records only inside tests; never use those records for real CLI launches. New tests cover missing launch evidence without branches/workspace directories, missing SDK selection, and identical-tree divergent ancestry. Existing source-only creation remains covered.

Real CLI smoke uses an explicitly selected collection and actual previously successful pinned protocol receipt. Choose fresh names and independently approved SDK refs. The following refusal cases must not create their target directories or feature branches:

```sh
CLI=/tmp/omniview-dev-setup-audit
COLLECTION=/Users/joshuapare/Repos/omniviewdev/workspaces
REVIEWED=5d0cc3dac81138ea87da1f94322873dde07aa9f2
"$CLI" workspace create setup-missing-proof-smoke --root "$COLLECTION" --repo plugin-sdk --reviewed-sdk-revision "$REVIEWED" --link-evidence /nonexistent/setup-audit-probe.json --start --json
"$CLI" workspace create setup-divergent-smoke --root "$COLLECTION" --repo plugin-sdk --ref plugin-sdk=v0.10.0 --reviewed-sdk-revision "$REVIEWED" --link-evidence "$ACTUAL_PROTOCOL_RECEIPT" --start --json
```

The divergent case depends on the registered repository resolving that tag to the divergent release described in the notes; independently inspect the resolved IDs. Do not move a tag to manufacture this case. Run source-only creation and read-only prerequisite inspection separately:

```sh
"$CLI" workspace create setup-source-only-smoke --root "$COLLECTION" --json
"$CLI" workspace preflight setup-source-only-smoke --root "$COLLECTION" --json
"$CLI" workspace inspect setup-source-only-smoke --root "$COLLECTION" --json
```

Expected: create succeeds without launch inputs, preflight refuses missing prerequisites, and inspection remains stopped. The two retained audit workspaces exercised source-only creation. Integration also exercised all three patched refusal cases and a real host-only browser launch/recovery; the linked verification record contains exact outcomes and limits. No marketplace backend archive or native-window acceptance is claimed.
