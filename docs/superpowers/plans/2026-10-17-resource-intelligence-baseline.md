# P00 Resource Intelligence Baseline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this single integration-owned packet. Steps use checkbox (`- [ ]`) syntax for tracking. Do not fan out this shared baseline or start dependent implementation before its receipt passes.

**Goal:** Establish a reproducible, actually linked and isolated host/SDK/UI/plugin source cohort before resource-intelligence changes.

**Architecture:** Reuse the existing host-owned workspace/link/profile tooling from reviewed committed sources, or an explicitly verified equivalent. Audit current consumers, select a coherent source cohort, run its actual linking protocol and host/plugin smoke, then publish a portable C00 receipt. P00 is verification/integration, not implementation of queries, replacement resource APIs or another workspace manager.

**Tech Stack:** Go modules with `GOWORK=off`; host Taskfile/Wails; actual pinned native pnpm 12.14.0; existing workspace CLI and profile identity; React/runtime shared exports. No new dependencies or test framework.

**Spec:** [Launch plan](2026-10-17-resource-intelligence-launch.md), [C00 and observed baseline](../../roadmap/2026-10-17-resource-intelligence-contract-readiness.md), [P00 acceptance and full backlog](../../roadmap/2026-10-17-resource-intelligence-work-packages.md). Existing workspace design is documented in [its plan](2026-10-17-agentic-workspaces.md); use current operational source rather than its older manager assumptions.

## Global Constraints

- This packet has no new product API, schema, IDL or evaluator. Do not “fix” old Find, fake namespace/GVK bodies or introduce a temporary v2 List transport.
- No global go.work/GOFLAGS/npm links; no automatic package upgrades, relaxed peer checks or invented version stamps. Existing reviewed local-source composition can intentionally substitute a source package; record its policy and prove runtime behavior rather than treating its original registry range as acceptance.
- Preserve user changes in every source checkout. Worktree creation uses committed refs; it does not copy another worktree's uncommitted implementation. Do not commit/reset/copy user work to make the bootstrap pass.
- All Go commands, including Task/subprocess environments, use `GOWORK=off`. Only `task bindings` regenerates Wails outputs. One integration owner runs state-changing linking/build/generation.
- Prefer an empty isolated profile, no seed, credentials, auto-connect or external cluster. Local profile isolation is not a sandbox for kubeconfig/cloud credentials/remote effects.
- Capture private machine paths/logs/receipts outside tracked docs. Never print tokens or commit generated workspace config, dependency overlays or secrets. The portable report normalizes paths to repository IDs.
- Do not treat current documentation, a successful compiler or an asset-only Vite page as app/plugin readiness. Failed prerequisites remain blockers with evidence, not an excuse to weaken verification.

## File structure and ownership

**Modify/create during execution:** `docs/roadmap/2026-10-17-resource-intelligence-baseline.md` — proposed portable baseline report, deliberately not created as an empty success record in this planning pass. Update C00 readiness only when evidence warrants it. There are no planned product-code modifications or permanent wiring tests.

**Read current root sources:**
- Host `go.mod`, `package.json`, `pnpm-workspace.yaml`, `Taskfile.yml`; `packages/omniviewdev-{runtime,vite-plugin}/package.json`; shared dependency maps, runtime public entrypoints and current resource service/wrapper.
- Sibling SDK `go.mod`, `Makefile`, `buf.gen.yaml`, `pkg/v1/resource` and handwritten client/server/convert adapters, common/resource/lifecycle IDL, SDK protocol/session context.
- Sibling Kubernetes `go.mod`, `plugin.yaml`, `ui/package.json`, `pkg/main.go`, `pkg/plugin/resource/register_v1.go` and resource/Helm test entrypoints.
- UI checkout `ui/main/packages/{base-ui,editors,ai-ui}/package.json` and actual package exports. Directory `ui` is not itself the assumed package worktree.

**Read existing managed-workspace source:** `$HOST_SOURCE/docs/development-workspaces.md` in the selected committed host checkout, its linked package-linking/profile/control/build/native guides, bootstrap Task entrypoint and CLI implementation. Resolve `HOST_SOURCE` from the registered source cohort and keep the machine-specific path in private notes. Inspect companion SDK/UI/Kubernetes repository IDs and selected refs before assuming directory layout or that any changes are committed or integrated.

**Private outputs:** existing CLI-owned collection/profile/logs/link receipts and a narrowly owned temporary native/protocol-probe directory. The integration owner records canonical identities before mutation; no hand-editing generated aggregate roots or profile files.

## Task 1: Record the current effective baseline

**Contract:** produce source-resolution facts only. Matching package versions are insufficient. **Evidence:** command exit/output, selected cwd and normalized source identities; no claims of live linking yet.

- [ ] Read the manifests/exports above through file tools. Capture declared manager, Go minimum, SDK versions, UI/runtime ranges, actual package entrypoints and package/repository IDs. Read committed `plugin.yaml` for plugin ID instead of deriving it from a directory.
- [ ] From the current host, run:

```sh
GOWORK=off go env GOVERSION GOWORK
GOWORK=off go list -m -json github.com/omniviewdev/plugin-sdk
```

- [ ] From the current Kubernetes checkout, run:

```sh
GOWORK=off go list -m -json github.com/omniviewdev/plugin-sdk
```

- [ ] Resolve the installed host and runtime UI package locations with `realpath`, then read their actual manifests. Resolve host base-ui/editors/ai-ui and runtime base-ui; also inspect runtime/Vite-plugin resolution from the selected plugin frontend. Record absent artifacts as absent, not successful fallback.
- [ ] Record the already observed starting discrepancy: host SDK v0.5.0 vs Kubernetes v0.4.0 module-cache resolution; host manifests base-ui ~0.4.3 and editors/ai-ui ~3.0.3 vs installed 0.4.2/3.0.2. Do not rerun these commands merely to doubt the supplied observation; use them to establish the chosen execution checkout's effective state.
- [ ] Record the candidate managed UI source manifests 0.4.3/3.0.3/3.0.3, and managed host runtime/Vite-plugin 0.2.1 vs plugin frontend ^0.4.2 requests. The former is a useful candidate, not proof; the latter requires reviewed local-source composition plus actual API acceptance, not an unrequested version bump.
- [ ] Draft the report's initial audit section with explicit status **audit only; C00 not passed**. Normalize absolute paths in the portable report and retain raw evidence privately.

## Task 2: Select and verify one source cohort

**Contract:** actual selected committed sources plus manager/tooling prerequisites; no resource API changes. **Files:** reviewed host/workspace/SDK/UI/plugin refs and their manifests; private CLI registry/receipt.

- [ ] Choose the observed managed-workspace host source as the first tooling candidate. Verify that its selected committed ref actually contains `cmd/omniview-dev`, `internal/devworkspace`, bootstrap Task and operational guide. A file existing only in a dirty working tree is not available to generated worktrees.
- [ ] Verify the companion SDK source descends from documented reviewed isolation commit `d32a524bc89659260c6045062035ce05dc138ff4`, with the documented source-isolation implementation available. Source-provenance Git ref/ancestry inspection is justified here; do not use routine git validation after every edit or modify user refs.
- [ ] Select existing UI committed source satisfying actual host/runtime UI peer ranges. Start with the observed compatible managed UI candidate; if its required changes are not committed, inspect existing compatible release/source refs without discarding feature changes. Do not manufacture a package version, downgrade host peers or silently abandon local UI source.
- [ ] Select the Kubernetes source and exact plugin ID from its committed manifest. Verify the reviewed local runtime/Vite source-substitution policy, required API exports and actual singleton protocol; if it cannot admit this source cohort, record the exact compatibility prerequisite instead of forcing an install.
- [ ] Bind these values from inspected identities: `HOST_SOURCE`, `FIXED_SDK_SOURCE`, `UI_SOURCE_OR_BARE_REPOSITORY`, `PLUGIN_SOURCE`, their explicit committed `*_REF` values, `PLUGIN_ID`, and a new CLI-owned `COLLECTION`. They are derived evidence, not arbitrary defaults. The collection must not be nested in a registered source repository and must not be a production state directory.
- [ ] Verify native pnpm 12.14.0 and required Task/Go/Node/Git/native tooling. Bind `BASELINE_PNPM_EXECUTABLE` to the verified absolute pnpm executable. Construct `VERIFIED_TOOL_PATH` from the recorded canonical directories containing those verified executables and required platform utilities; exclude empty/relative entries and unreviewed directories, and never copy the caller's full `PATH`. Confirm executable resolution under that path agrees with the recorded identities. Do not globally downgrade/upgrade the agent's manager. Verify actual OS support before claiming native smoke; browser and native acceptance are distinct.
- [ ] Review current operational guide commands against the selected source. If this reviewed capability is not available, a verified existing equivalent may be used only if it proves the same source/peer/export/profile/cleanup properties. Do not build a new manager in P00.

**Stop gate:** a missing reviewed committed host/SDK capability, incompatible cohort or missing safe isolation prevents linkage execution. Complete the reachable audit/report and state exactly what must become available. Keep P00 open; do not launch P44/P04/P18 implementation on a falsely passed receipt.

## Task 3: Bootstrap existing tooling and obtain actual link evidence

**Contract:** successful pinned protocol evidence and managed source selection. **State changes:** only selected CLI-owned arena/worktrees/profile and owned probe outputs; no source package-manifest changes.

- [ ] From the selected host source, use its documented bootstrap-aware entrypoint. All variables below come from Task 2's recorded selection, not guessed refs:

- [ ] Before any baseline bootstrap/init/probe/launch, allocate a private empty `ISOLATION_HOME` outside registered source repositories and production state. Record its owned path privately and use the same clean environment for every command through inspect/down/removal; otherwise profile/ownership registries can split across homes. Resolve `BASELINE_PNPM_EXECUTABLE` to the verified absolute pnpm 12.14.0 executable from Task 2. Do not copy kubeconfig, cloud credentials, shell startup files or user package-manager configuration into this home.

```sh
ISOLATION_HOME="$(mktemp -d "${TMPDIR:-/tmp}/omniview-resource-baseline.XXXXXX")"
BASELINE_PATH="${VERIFIED_TOOL_PATH:?set the verified tool-directory allowlist from Task 2}"
mkdir "$ISOLATION_HOME/tmp" "$ISOLATION_HOME/.config" \
  "$ISOLATION_HOME/.cache" "$ISOLATION_HOME/.local"
baseline_env() {
  env -i HOME="$ISOLATION_HOME" PATH="$BASELINE_PATH" \
    TMPDIR="$ISOLATION_HOME/tmp" XDG_CONFIG_HOME="$ISOLATION_HOME/.config" \
    XDG_CACHE_HOME="$ISOLATION_HOME/.cache" XDG_DATA_HOME="$ISOLATION_HOME/.local" \
    GOWORK=off GOFLAGS= OMNIVIEW_PNPM_EXECUTABLE="$BASELINE_PNPM_EXECUTABLE" "$@"
}
```

This excludes inherited Kubernetes/cloud configuration variables, credential-process settings, agent sockets and user-home defaults. Only reviewed toolchain additions may extend the allowlist; never forward the caller's full environment or credential-bearing paths. If a selected plugin requires credentials or an external connection even for the proposed harmless operation, stop that smoke and report the missing safe acceptance prerequisite. Clean environment/profile isolation is not an OS sandbox: native plugins can still read arbitrary user-accessible files or reach metadata/network services, so inspect the selected connection-free path and do not claim hostile-plugin credential isolation.

```sh
DEV="$(baseline_env env SDK_SOURCE="$FIXED_SDK_SOURCE" task --silent dev:cli:build)"
baseline_env "$DEV" workspace init --root "$COLLECTION" \
  --source "omniview=$HOST_SOURCE" \
  --source "ui=$UI_SOURCE_OR_BARE_REPOSITORY" \
  --source "plugin-sdk=$FIXED_SDK_SOURCE" \
  --source "selected-provider=$PLUGIN_SOURCE" \
  --source-ref "omniview=$HOST_REF" \
  --source-ref "ui=$UI_REF" \
  --source-ref "plugin-sdk=$SDK_REF" \
  --source-ref "selected-provider=$PLUGIN_REF" --json
```

The registry ID `selected-provider` is local source ownership; `PLUGIN_ID` is the actual manifest plugin ID. Do not infer one from the other.

- [ ] Allocate a privately owned `PROBE_DIR` and `LINK_EVIDENCE` path. From the selected host checkout (`HOST_SOURCE`), follow the current guide's existing host-modfile and real pinned link-probe procedure, with effective SDK/native selection:

```sh
PROBE_DIR="$(mktemp -d "$ISOLATION_HOME/probe.XXXXXX")"
LINK_EVIDENCE="$PROBE_DIR/link-evidence.json"
mkdir "$PROBE_DIR/native" "$PROBE_DIR/module"
HOST_MODFILE="$(baseline_env env GOWORK=off GOFLAGS= go run ./scripts/hostmod/main.go \
  --root "$PWD" --sdk-source "$FIXED_SDK_SOURCE" \
  --output-directory "$PROBE_DIR/native")"
cp "$HOST_MODFILE" "$PROBE_DIR/module/probe.mod"
cp "${HOST_MODFILE%.mod}.sum" "$PROBE_DIR/module/probe.sum"
baseline_env env GOWORK=off GOFLAGS= A11_PROTOCOL_PROBE=1 A11_PROTOCOL_REPORT="$LINK_EVIDENCE" \
  go test -modfile="$PROBE_DIR/module/probe.mod" -tags server ./internal/devworkspace \
  -run '^TestLinkPinnedProtocolProbe$' -count=1
```

- [ ] Inspect the producer's successful receipt: native manager identity, recursive peer audit, actual singleton/live-export/atomic-dist results and exact source hashes. A manually constructed JSON report, install exit0, missing dist or stale successful receipt cannot substitute.
- [ ] Do not delete the probe directory until its owned process/output lifecycle is closed and evidence is retained. Retain failed producer evidence; use the ownership-aware cleanup contract rather than broad recursive removal.
- [ ] No independent plugin installs, global links or hand-edited aggregate lockfiles. If source dependency/peer policy changes, stop and use controlled unlink/link to replan before continuing.

## Task 4: Launch the real host and selected plugin in an isolated profile

**Contract:** actual host/plugin identity and source usage, not merely a build. **Files:** existing selected CLI/profile/control and frontend/export paths. No new UI component or permanent smoke framework.

- [ ] Create a uniquely named baseline workspace `resource-intelligence-baseline` in the newly owned collection. If it already exists, inspect ownership instead of overwriting/reusing an unrelated arena. Use the existing CLI:

```sh
baseline_env "$DEV" workspace create resource-intelligence-baseline --root "$COLLECTION" \
  --repo ui --repo plugin-sdk --plugin "$PLUGIN_ID" \
  --start --mode browser \
  --reviewed-sdk-revision d32a524bc89659260c6045062035ce05dc138ff4 \
  --link-evidence "$LINK_EVIDENCE" --json
baseline_env "$DEV" workspace inspect resource-intelligence-baseline --root "$COLLECTION" --json
baseline_env "$DEV" workspace paths resource-intelligence-baseline --root "$COLLECTION" --json
```

- [ ] Keep `GOWORK=off` effective for CLI children. Let its producer own host-modfile/bootstrap preparation, package linking, `task bindings`, runtime-before-Vite build and process graph. Do not concurrently launch manual generators/builds.
- [ ] Verify launch readiness belongs to the exact UUID/generation/state root/selected host source and selected plugin. Plugin RPC may be a private Unix socket; do not fabricate a TCP target. A timeout or Vite listener alone is not readiness.
- [ ] Open the **observed** `instance.endpoints.browser` in the real browser, not Vite's asset URL. Verify its boot identity against inspect before actions. Observe actual host shell, selected plugin loaded or truthful connection-free state, and no import/ABI/shared-export failures. Record console and rendered evidence; never expose private control/MCP tokens.
- [ ] Exercise a harmless existing UI package surface and existing selected-plugin contribution. Use the existing live-export/link probe's reversible source edit/restore mechanism to show the selected component source reaches a live consumer; no source-text test, mock response or unbounded demo harness. Confirm shared React/runtime identity through the existing producer's actual acceptance, not matching paths alone.
- [ ] Verify effective SDK source resolution from **both managed Go consumers**, using their captured effective modfiles/environments from the managed source receipt. A plain `go list` that ignores the launcher modfile does not prove child selection. Record canonical source directory/revision, not just requested version.
- [ ] Run a harmless existing resource/catalog or connection-free discovery operation through the actual host→managed plugin boundary. Observe the response/error and correlation without connecting to a cluster. Direct-controller tests do not substitute for actual codec/plugin dispatch. If no safe connection-free operation exists, report that missing acceptance prerequisite; do not invent data or silently count the shell as resource proof.
- [ ] Close the browser tab after capturing evidence. A browser-mode pass establishes real server/browser behavior, not desktop WebView/native MCP acceptance. If native support is claimed for the baseline, run a separate existing native-profile smoke with confirmed toolchain/identity, without seeding production state.

## Task 5: Verify affected boundaries without duplicating managed work

**Contract:** useful existing behavior still works under the selected sources. No new permanent wiring tests; use existing consumer-visible cases and bounded throwaway scripts only where needed.

- [ ] After the managed graph settles, reuse its actual build results where identical. For additional affected checks, use the selected SDK/native module environment, not a clean registry-only invocation accidentally testing different code.
- [ ] Using each consumer's captured effective modfile/environment from the managed source receipt, run the existing host entrypoint `GOWORK=off go build .` and targeted SDK entrypoints `GOWORK=off go test ./pkg/v1/resource/... ./pkg/sdk ./pkg/interceptors -count=1`. Reuse an identical managed result instead of rerunning it. Include real client/server codec cases where a changed source selection affects their boundary.
- [ ] Using the captured managed Kubernetes environment, run the existing entrypoints `GOWORK=off GOEXPERIMENT=jsonv2 go build -o bin/plugin ./pkg` and `GOWORK=off go test ./pkg/plugin/resource/... ./pkg/plugin/helm/... -count=1`. Do not run `make generate`, tidy or lint fix as checks.
- [ ] Verify runtime package build precedes Vite-plugin build/shim checks; inspect the managed receipt's actual command/result before scheduling a duplicate. Use the selected UI package's build/typecheck and meaningful existing behavior cases when source integration changes them.
- [ ] For every check, report cwd/source identity, effective environment, command, observed result and limit. Existing unrelated failures are evidence to classify, not permission to suppress exceptions or rewrite incidental test expectations. No cold-start/steady-state performance threshold is invented here; P02 owns measured production budgets.

## Task 6: Publish C00 and hand off only when it passes

**Create:** `docs/roadmap/2026-10-17-resource-intelligence-baseline.md` during execution. The report is the portable deliverable; raw paths/profile details stay private.

- [ ] Include: source repo IDs/refs/commits and dirty-source limitations; declared vs effective module/package/peer source; exact manager/toolchain; reviewed local runtime-source policy; link receipt identity; host/plugin codec/UI observations; browser-vs-native limit; owned profile/cleanup disposition; observed failures and exact blockers.
- [ ] Include caller/removal ownership: host resource service/controller, consumed SDK v1 vs older root generation, runtime hooks/cache/public entries, default host table, generated bindings, loader/contributions and release/shared maps. Keep active logs/exec/network/metrics/settings and current useful renderers visible for later cutover.
- [ ] **Pass C00 only if** both Go consumers demonstrably use selected SDK source, actual UI/runtime source/peer/shared-export acceptance passes, actual selected host/plugin smoke passes, isolation is verified and downstream ownership is assigned. Source inspection or a fake-backend benchmark cannot satisfy these conditions.
- [ ] If blocked, publish the audit plus exact unavailable prerequisite/attempts and leave P00/C00 open. No empty “ready” fields, fabricated benchmark figures or automatic dependent-code dispatch.
- [ ] Stop owned processes with `baseline_env "$DEV" workspace down` against the recorded collection/workspace. Use the same isolated home/environment for all lifecycle commands. If retiring the throwaway arena, use existing controlled unlink/remove after evidence retention; ordinary removal keeps state/branches. No `--delete-state`, `--delete-branches`, PID killing or source resets without separate authorization. Keep refused cleanup artifacts and their isolated home for inspection; retire the home only after owned process/profile lifecycle and evidence retention are complete.
- [ ] Review report/readiness changes; do not auto-commit or merge. On acceptance, dispatch only P44/P04/P18 independently under the launch plan's ownership/contracts, then release later nodes as their own predecessors pass.

## Literal next assignment

Execute P00 from this plan as the integration owner. Start by inspecting the observed managed-workspace source cohort and available committed refs, and complete the read-only/current-consumer audit. Reuse its existing reviewed CLI/link/profile contract; do not implement resource features or recreate workspace tooling. Produce the proposed baseline report with actual effective source/module/package resolution and host/plugin/UI observations. If committed tooling, compatible sources or safe runtime proof is unavailable, finish the reachable audit and report the precise blocker; leave C00 open. Do not launch dependent implementation or change external clusters.
