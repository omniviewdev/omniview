# Development workspaces

The host-owned CLI manages independent Git worktrees, one pnpm workspace per feature, isolated development profiles and persistent launch supervisors. Commands below replace manual developer-settings dialogs and global links. Runtime/platform acceptance is recorded separately; source implementation is not proof that every native, plugin and HMR combination has passed.

The [workspace roadmap](development-workspaces-roadmap.md) records research decisions, repository routing, ordered parallel work packets, exercised evidence and remaining acceptance gates.

## Bootstrap the local CLI and sources

Use the bootstrap-aware Task entry point. Ordinary bootstrap consumes the published SDK version declared by the host's `go.mod`. For local SDK development, `SDK_SOURCE` is explicit: there is no inferred sibling replacement, global `go.work`, global `GOFLAGS`, package upgrade or canonical-source mutation.

Task first runs a standard-library-only bootstrap entry. It selects explicit SDK source, or the exact SDK repository linked by an enclosing workspace whose canonical host directory matches this checkout; otherwise it uses the declared published module. Local-source preparation uses a private temporary module and refuses ambiguous, escaping or conflicting selections. The full CLI independently validates the manifest, profile and source/cache authority. Temporary preparation is removed after bootstrap exits; the immutable CLI and its owned cache remain managed by the full bootstrap.

Current host/UI/plugin/probe manifests pin **pnpm 12.14.0**. Install the native executable on PATH, or explicitly export `OMNIVIEW_PNPM_EXECUTABLE=/canonical/absolute/native/pnpm` when an existing agent process still sees an older shell/Corepack installation. The managed launcher validates the actual version and does not downgrade the global installation. Node is still needed by application build scripts; native pnpm itself is not a Node entry point.

An installed Homebrew formula can be available even when an already-running agent has no `pnpm` command on PATH. Select its canonical executable without installing another version or changing global links:

```sh
export OMNIVIEW_PNPM_EXECUTABLE="$(realpath "$(brew --prefix pnpm)/bin/pnpm")"
export PATH="$(dirname "$OMNIVIEW_PNPM_EXECUTABLE"):$PATH"
```

The pnpm12 workspace policy retains 24-hour release-age protection (`minimumReleaseAge: 1440`), with immediate registry updates exempted only for `@omniviewdev/*`. Managed composition rejects conflicting release-age settings rather than silently disabling protection. Linked source worktrees do not require newly published registry versions. Strict peers, exact manager pins, frozen-lockfile verification and managed `--ignore-scripts` remain. Non-auth `.npmrc` settings live in workspace YAML; native12 lockfile metadata remains package-manager-owned.

Choose source refs that satisfy the actual peer contracts: compare the host's `packages/omniviewdev-runtime/package.json` with the selected UI's `packages/base-ui/package.json`. A checkout can lag an existing compatible release tag. Select compatible released source while preserving feature changes; do not invent a package version or weaken peer validation to make an older source pass.

The generated package root is `$COLLECTION/workspaces/<feature>`, above its host/UI/plugin worktrees. Managed native12 commands keep the actual consumer cwd/argv while enforcing this root through `PNPM_CONFIG_WORKSPACE_DIR`. Source configs/lockfiles remain standalone; compatible policies and locked registry resolutions are reconciled explicitly, and conflicts refuse mutation. Do not hand-edit generated root files or run independent plugin installs inside a managed feature.

The host workspace includes its packages and E2E tooling; host TypeScript projects own `ui/` and `packages/`, not plugin repositories under `plugins/`. Each plugin's own project owns its dependencies, aliases and tests. Managed features add only explicitly selected plugin repositories; initializing an unselected submodule must not change host compilation or dependency resolution.

```sh
# Run from the host checkout containing the workspace implementation.
DEV="$(task --silent dev:cli:build)"

"$DEV" workspace init --root "$COLLECTION" \
  --source "omniview=$HOST_SOURCE" \
  --source "ui=$UI_SOURCE_OR_BARE_REPOSITORY" \
  --source "plugin-sdk=$FIXED_SDK_SOURCE" \
  --source "plugin-a=$PLUGIN_A_SOURCE" \
  --source "plugin-b=$PLUGIN_B_SOURCE" \
  --source-ref "plugin-sdk=v0.6.0" --json
```

Each source is an explicit local normal or bare Git repository. Use repeatable `--source-ref ID=REF` and `--source-directory ID=DIRECTORY` when defaults differ. Plugin IDs are read from committed `plugin.yaml` at the selected ref, never inferred from a directory name. Selected host refs must contain the tooling; creating a worktree does not copy uncommitted host changes from another checkout.

Register every repository/plugin source needed by the collection up front. Registry source mappings are deliberately immutable: repeating the same initialization is allowed, but changing or adding mappings returns `registry_exists` with conflict exit4 and leaves the existing registry intact. Initialize another collection for a different source set; `workspace edit --add-plugin` selects an already registered plugin, not a new repository registration.

The reviewed published SDK `v0.6.0` commit is `1e92fb518b117814acb504aaae1772ff39abcdef`, including the shared read-only profile contract required by this host. Select that release or a reviewed descendant; SDK `v0.5.2` and earlier lack the contract. Subsequent ordinary edits in the selected feature SDK worktree are live development input and do not require per-edit commits. Protected isolation implementation changes require the explicit warning-bearing `--allow-isolation-source-changes` flag; it is scoped to this workspace's child processes and is not a sandbox.

Local package linking requires the actual successful pinned pnpm protocol probe report, not manually asserted booleans. Run the probe once on the integrated host source with its effective SDK-aware module selection, then pass the report explicitly (or place it at `$COLLECTION/.omniview-dev/link-protocol.json`):

```sh
PROBE_DIR="$(mktemp -d)"
mkdir "$PROBE_DIR/hostmod" "$PROBE_DIR/module"
HOST_MODFILE="$(GOWORK=off GOFLAGS= go run ./scripts/hostmod/main.go \
  --root "$PWD" --sdk-source "$FIXED_SDK_SOURCE" \
  --output-directory "$PROBE_DIR/hostmod")"
cp "$HOST_MODFILE" "$PROBE_DIR/module/probe.mod"
cp "${HOST_MODFILE%.mod}.sum" "$PROBE_DIR/module/probe.sum"
GOWORK=off GOFLAGS= A11_PROTOCOL_PROBE=1 A11_PROTOCOL_REPORT="$LINK_EVIDENCE" \
  go test -modfile="$PROBE_DIR/module/probe.mod" -tags server ./internal/devworkspace \
  -run '^TestLinkPinnedProtocolProbe$' -count=1
rm -rf "$PROBE_DIR"
```

The probe performs real native12 recursive peer, singleton, live-export and atomic-dist checks across one aggregate workspace. A failed installer/audit is not converted to missing-dist success; install exit0 alone does not attest warm peers. Bootstrap composes/installs once, audits recursively, then builds missing exports in dependency order and verifies actual resolution.

## Create and start, then run a second profile

```sh
"$DEV" workspace create feature-a --root "$COLLECTION" \
  --repo ui --repo plugin-sdk \
  --plugin "$PLUGIN_A_ID" --plugin "$PLUGIN_B_ID" \
  --start --mode browser \
  --reviewed-sdk-revision 1e92fb518b117814acb504aaae1772ff39abcdef \
  --link-evidence "$LINK_EVIDENCE" --json

# The same plugin ID can run independently in another profile.
"$DEV" workspace create feature-b --root "$COLLECTION" \
  --repo ui --repo plugin-sdk --plugin "$PLUGIN_A_ID" \
  --start --mode browser \
  --reviewed-sdk-revision 1e92fb518b117814acb504aaae1772ff39abcdef \
  --link-evidence "$LINK_EVIDENCE" --json

"$DEV" workspace inspect feature-a --root "$COLLECTION" --json
"$DEV" workspace paths feature-a --root "$COLLECTION" --json
```

`create --start` creates sources, safely seeds an optional new profile, applies/installs selected links, generates bindings through `task bindings`, builds packages in order, bootstraps the pinned native patch, compiles the actual selected host and starts every selected managed plugin. Native Darwin builds also run the real development app-bundle Task. Only the owned processes' actual identity/protocol readiness produces `launchPhase: "ready"`.

The persistent supervisor outlives the short CLI. `--timeout` bounds the caller/build/readiness wait; timeout does not turn unfinished work into success or authorize a PID kill. Inspect/down remain available for that recorded supervisor. The supervisor owns the actual host and Node/Vite commands and their process trees. On Darwin, it retains unreaped child leaders until owned group cleanup; detached numeric-PID termination is never used as a fallback.

Browser mode starts the real Wails server. Use `instance.endpoints.browser`, **not** the asset-only Vite URL. `--live-frontend=false` serves built assets instead of launching host Vite. `--watch=false` disables the supervisor build graph; otherwise its lifetime owns serial source rebuilds and real managed-generation waits. Runtime/shim changes restart actual consumers; a successful compiler exit alone is not plugin readiness.

Backend readiness is not browser-side plugin import readiness. A cold browser can render the shell before the initial plugin batch, route publication and loader resolution complete. Wait for the selected rendered plugin, not just a Vite socket or shell; live-mode inspection also exposes `window.__PLUGIN_SERVICE__.getDebugSnapshot()` with service/plugin phases and route version. After an automatic document replacement, repeat browser bootstrap before exercising its controls. A `framenavigated` event alone is not reload proof: same-URL router `history.replaceState` and fragment changes stay in the same document; compare `performance.timeOrigin` or browser protocol navigation events.

After restart, wait for the document's frozen boot identity to match the
authenticated replacement generation before testing controls. Host and plugin
Vite clients can reload the parent page, even with an optimized host; a
simultaneous same-URL `goto` can abort either navigation. The Chromium E2E
`restartApp` helper requests `Page.reload` without awaiting one particular
navigation, then verifies the replacement generation, document load and shell.

The host explicitly disables Vite's agent-detected console forwarding: its
existing diagnostics bridge owns structured forwarding, and Playwright captures
browser errors independently. Vite8.0.1's forwarding can recursively reject with
`send was called before connect` while its HMR socket is disconnected. This
does not disable browser console output, diagnostic RPCs or failure artifacts.

For a desktop window, choose `--mode native`. Native MCP additionally requires `--mcp`; it is authenticated, explicitly compiled development tooling, not a production endpoint. The private per-generation MCP token is in `<workspace>/.local/mcp-<generation>.secret`; never print/share the token. MCP is advertised only after the host confirms actual authenticated native JavaScript/binding identity. Browser/native support and required OS versions remain distinct; see [native toolchain](development-native-toolchain.md).

## Endpoints, ports and context

Inspection separates lifecycle phase, build stages, the authenticated `instance` descriptor and externally owned `services`. Host/control readiness is verified against the exact UUID, generation, selected state root, selected host source and captured process identity. Browser HTML must contain the selected safe boot identity. Vite/HMR require the actual owned listener plus a real authenticated websocket `connected` frame; `services.vite.hmr` retains the observed HMR path, not a guessed HTTP-to-WS conversion. Host descriptor endpoint fields remain null until their own actual observation succeeds.

Plugin RPC readiness comes from the observed managed lifecycle. Its go-plugin handshake transport can be a private Unix socket and is deliberately not a public agent target. Agents use the canonical authenticated control endpoint, never a fabricated plugin TCP address. Frontend-only or backend-only capabilities retain truthful not-applicable stages; unsupported plugins fail rather than being silently skipped.

Sticky ports are default. Explicit overrides and strict policy never silently increment:

```sh
"$DEV" workspace up feature-a --root "$COLLECTION" \
  --port-policy strict --port browser=24101 --port vite=24102 \
  --port "plugin-vite:$PLUGIN_A_ID=24103" --json
```

Available override keys are `browser`, `vite`, `mcp` and `plugin-vite:<selected-plugin-id>`; `--port ROLE=0` clears an override. Create/edit/up persist the policy through the lifecycle journal. Sticky bind-race retries are bounded and require an actual owned-child bind failure for that exact port. Occupied ports are never a reason to kill their owner. Inspect reports actual assigned endpoints, not merely reservations.

`--workspace PATH` or a positional manifest/directory is authoritative. Named/UUID targets use `--root COLLECTION` or an enclosing initialized collection. Invalid explicit context does not fall back to production, another workspace or an unrelated environment. Conflicting `OMNIVIEW_WORKSPACE_FILE`/`OMNIVIEW_STATE_DIR` selections fail closed; unset stale context before intentionally selecting another workspace.

## Settings baseline and custom state roots

Default state is `~/.omniview-dev/profiles/<UUID>/state`; runtime, artifacts and native/browser storage remain UUID-owned. A custom state location is a separate explicit machine-local binding:

```sh
"$DEV" workspace profile feature-a --root "$COLLECTION" \
  --state-root "$DEDICATED_CUSTOM_PROFILE/state" --json
```

`create --state-root` performs the same binding before optional seed/start. The dedicated custom container must be absent/empty or already owned by that UUID. A private binding, canonical path and matching ownership marker are required; an arbitrary environment variable cannot redirect an existing profile. Rebinding is stopped-only and uses the stable UUID/root guards.

For an initial baseline, add `--seed-from "$STOPPED_SOURCE_STATE" --seed-version "$SOURCE_VERSION"` to the first create/start or up. The source must be stopped and the destination state root absent. The launcher seeds **before** A11's stopped-profile lock can create the destination `.lock`; it never removes/replaces a held lock inode to make copying work. Only allowlisted preferences and an inactive plugin inventory are copied. Credentials, connections/autoconnect, executable/plugin data, discovery/tokens, sessions, caches and native/browser storage are excluded. Selected managed source plugins are rebuilt/linked separately; an imported inventory does not execute unknown binaries. A recorded seed intent can recognize an already-published matching baseline after interruption without overwriting settings.

Profile isolation does not isolate HOME, kubeconfig, cloud credentials, terminals or remote cluster effects. Do not treat a development badge, copied preferences or a different local plugin root as permission to mutate a production cluster.

## Edit, restart, stop and remove

```sh
"$DEV" workspace edit feature-a --root "$COLLECTION" \
  --add-plugin "$ANOTHER_PLUGIN_ID" --remove-plugin "$PLUGIN_B_ID" \
  --ref "plugin-a=$SELECTED_REF" --json
"$DEV" workspace up feature-a --root "$COLLECTION" --json
"$DEV" workspace restart feature-a --root "$COLLECTION" --json
"$DEV" workspace down feature-a --root "$COLLECTION" --json
"$DEV" workspace remove feature-a --root "$COLLECTION" --json
```

Edits require a stopped supervisor and preserve UUID/profile/unaffected assignments. The orchestrator preserves exact link evidence, unlinks the old overlay, invokes A03's validated durable intent transaction and relinks the committed selection. A validation failure with unchanged intent restores previous links. A Git failure after durable intent remains explicit/resumable (`workspace resume`), not a falsely promised inverse rollback. Ref/removal/rename operations refuse dirty or foreign worktrees. `link`, `unlink`, `list`, `resume` and `rollback` are real CLI lifecycle commands too; Task `workspace:<verb>` wrappers forward the same quoted arguments.

After editing source dependency/peer manifests or workspace policy, stop the instance and use the controlled unlink/link lifecycle to replan before `up`; do not keep a live Vite consumer on stale installed metadata. Source edits remain user-owned. The completed receipt is required by host and plugin startup, and a peer-only edit invalidates it even if pnpm's warm install would skip peer resolution.

Ordinary remove retains state and feature branches. `--delete-state` and `--delete-branches` are separate deliberate destructive selections. Filesystem profile purging includes UUID runtime/webview roots even with custom state; the external custom ownership marker/claim is retained. All canonical dirty/foreign/branch/profile refusal checks run before native deletion. Before its first native launch, the supervisor retains the complete hash-verified original `.app` in private UUID-owned external storage, preserving its immutable `dev.omniview.workspace.<UUID>` bundle identifier, executable, signatures and resources. This is not a naked executable or a differently named wrapper. Removal runs that actual patched bundle's native helper under A03's inherited UUID/state lock capabilities and requires its real WebKit callback. Failure retains state/worktrees and the bundle for retry; only committed removal retires the exact validated snapshot. Slug or custom-state-root changes do not rekey native storage.

Generated config, secrets, logs and build outputs have a private external UUID ownership ledger. Cleanup validates every recorded hash/type and all nested entries before deletion. Changed/unrecorded files, redirected paths and active generations refuse cleanup. Partial controlled builds are recorded even when compilation fails. A crash before output attestation leaves a durable `generated_pending` ownership conflict: unknown compiler output is not retroactively adopted, deleted or made safe by a numeric PID. Publication that had already recorded complete output proof can be resumed through the recorded transaction. Source/state/branches are never reset to bypass these conflicts.

Ignored dependency/build/cache outputs have exact producer-scoped ownership, not blanket `.local`/`node_modules`/`dist` exemptions. One aggregate installer preserves lockfile provenance, uses strict peers and `--ignore-scripts`, then runs a recursive peer audit; the graph owns generation. Vite/cache lifetimes end only after actual process/descendant exit. Tracked generated bindings/shims still require the developer's normal commit/discard decision. Interrupted cleanup resumes only its recorded per-path progress.

Managed children receive nonsecret `OMNIVIEW_DEV_CLI` from the captured supervisor executable. Bridge token references and native-removal FD capabilities remain host/helper-only. Authenticated `/v1/process` accepts only fixed selected plugin dev commands with exact composition root/version, actual frontend paths and current host leases—not arbitrary commands/cwd. Second plugin installs are rejected; startup consumes the completed aggregate receipt. The outer supervisor retains actual children independently of the desktop host for crash cleanup.

## Output and references

`--json` emits one machine-readable result on stdout; process/compiler output stays in the private supervisor log, and CLI warnings/diagnostics use stderr. Token **values** never enter descriptors or ordinary startup output. Error responses remain JSON on stdout. Exit codes are 0 success, 2 invalid request, 3 missing target/dependency evidence, 4 identity/state/ownership/port conflict, 5 operation/build failure, 6 unauthorized and 7 timeout.

## Application E2E

Run the canonical suite from a clean, committed standalone host checkout with
Node 24.14.0, native pnpm 12.14.0 and Playwright 1.64.1. A managed feature
worktree is a source input, not a second package-install root.

```sh
export GOWORK=off
export SDK_SOURCE=/absolute/plugin-sdk UI_SOURCE=/absolute/ui
export KUBERNETES_SOURCE=/absolute/kubernetes
export REVIEWED_SDK_REVISION=<reviewed-full-sdk-commit>
task e2e
task e2e -- --changed --base origin/main
task e2e -- --grep 'published consumers'
```

Full execution is the default. Change selection unions affected groups and
falls back to full for unknown/core changes, incomplete Git data or a changed
source cohort. A focused `--grep` run is diagnostic evidence, not full acceptance.
Tooling-only selections do not prepare a Go application.

The prose-only allowlist includes these approved roadmap documents under
`docs/roadmap/`: `2026-10-17-product-roadmap.md`,
`2026-10-17-resource-intelligence-baseline.md`,
`2026-10-17-resource-intelligence-contract-readiness.md`,
`2026-10-17-resource-intelligence-work-packages.md`,
`2026-10-23-resource-intelligence-remote-index.md` and
`2026-10-25-global-command-search-acceptance.md`.
Other roadmap files are unclassified and still force full execution. Prose skips
require a complete committed Git diff and an unchanged source cohort; renames
classify both old and new paths, and uncommitted changes never skip.

`task e2e-ui` opens an interactive debugging session, not a timed acceptance run.
It has no session-wide acceptance deadline; preparation and retirement commands
remain individually bounded, and closing or interrupting the session still
drains owned processes. Its report records `interactive: true` and no acceptance
budget rather than certifying the 600-second full-run gate.

One invocation-private source cohort links the selected SDK, UI and plugins
through the native package protocol. Producers build each required artifact
once; two actual runtime profiles share immutable artifacts but have distinct
HOME, state, storage, origins and authenticated instance identities. Browser
cases exercise real UI/binding persistence, plugin rendering, isolation and
owned process replacement. An explicit document reload is not automatic source
recovery or canonical supervisor-restart proof.

Producers run sequentially in canonical dependency order, followed by the plugin
Go compilers. Every command retains stopped-workspace and selected-source
admission. A failed command stops the remaining producers; owned descendant
disposal completes before returning. Plugin assets are finalized only after
every producer succeeds. The private `application/build-execution.json` records
actual stage start offsets, durations, outcomes and selected SDK identities;
`invocation.json` includes that report as `buildExecution`.

Small runtime-export/CSS producer-consumer contracts use real Vite, shim and
externalization adapters in the same Playwright invocation. The real selected-SDK
compiler/watch/settings-RPC failure-repair contract runs in the Go suite as
`TestSelectedSDKAPIRealCompileRPCAndRecovery`; it does not build the IDE.

The full acceptance budget is 600 seconds including dependency preparation,
cohort builds, profile startup, cases, replacement and teardown. Cases default to
30 seconds, with a 60-second bound for actual process replacement and no retries.
`invocation.json` and `case-timings.json` distinguish preparation, assertions and
cleanup without excluding them from the total. A listener or app shell alone
does not prove plugin rendering.

Owned child/descendant disposal precedes canonical output restoration and
cohort unlink/removal. Refused cleanup retains private state and journals;
unknown files, foreign sources and production credentials are never adopted.

### Main-scope native cache preparation

PR validation and trusted pushes to `main` share `.github/workflows/e2e-runner.yml`.
PRs execute the selected application suite once. The small, always-evaluated
`e2e-tests` check preserves the required check name and succeeds only when that
canonical job succeeded, including an explicitly proven prose-only skip. Failed,
cancelled, missing or skipped jobs cannot make the gate green.

The separate push-main cache primer first performs lookup-only requests for the
same exact Go and native pnpm keys used by PRs. If both payloads exist, it skips
native preparation entirely; fallback hits or missing outputs do not count.
On a miss it restores the existing same-toolchain/store fallbacks, then runs:

```sh
OMNIVIEW_E2E_TOOL_CACHE_ROOT=/absolute/owned-native-cache \
  node e2e/scripts/run.mjs --cache-only
```

This exclusive mode uses the same committed complete source cohort, reviewed SDK,
actual native composition protocol probe, SDK-aware Task-owned Wails preparation,
producer dependency order (runtime before Vite shims), source proof and canonical
cohort/private preparation retirement. It does not install Chromium, start
application profiles or run browser/application assertions. Its report records
`operation: "cache-only"` and `applicationAcceptance: false`; success is cache
preparation evidence, never application acceptance. The inclusive 600-second
clock, first-attempt failure and refusal/retained-evidence cleanup behavior remain
unchanged.

Only native Go module/compiler and pnpm content payloads are saved beneath a
fresh authenticated private cache container; ownership markers, application
outputs/binaries, managed receipts, profiles and private source cohorts are never
cached. Main saves require successful canonical preparation and retirement.
Linux APT archives retain their independent package-index/hash authentication.
No privileged `workflow_run` or PR artifact promotion is involved: main-scope
payloads are created by trusted main pushes and are then available to PRs.

### Verified local execution

The full canonical invocation on 2026-10-25 passed all 85 cases with zero retries
in **301.955 seconds**, including dependency preparation, the single source-cohort
build, actual profile startup/replacement, assertions and complete retirement.
The host source was `1db293fb18867ead0fd206d2e20669f53d36365f`, SDK
`9ba88075a39e5406926a22d536722afecaab465c`, UI
`c437aca20d853aa6f65f0fa437ada3e0bcfc82f9`, and Kubernetes
`977e51e6bd51854fc7656b1eba96dce8c89d48c7`.

Environment: macOS 27 arm64, Go 1.26.1, Node 24.14.0, native pnpm 12.14.0,
Playwright 1.64.1 and its Chromium build. Native dependency/compiler payloads
were reused; application artifacts and profiles were freshly produced. This is
local evidence, not a cold-run or Linux CI timing claim.

| Measured phase | Seconds |
|---|---:|
| Sequential application producers | 135.914 |
| All case assertions and worker teardown | 63.876 |
| Owned application process teardown | 0.571 |
| Canonical cohort unlink/removal | 55.663 |
| Private preparation retirement | 0.402 |

The ownership receipt proved all five launched/replaced processes drained with
`childrenEmpty: true`. The six application journeys each completed in
0.637–10.2 seconds. Separate real SDK compiler/watch/RPC contracts and the
published runtime/CSS contracts retain their own boundary evidence.

Canonical supervisor-driven source-to-browser recovery remains a separate
[acceptance gate](https://github.com/omniviewdev/omniview/issues/124);
explicit process replacement and document reload do not certify that gate.

### Static checks

`task check:ui-lint` covers host UI, Vite-plugin source and E2E TypeScript through the flat ESLint configuration and is blocking in PR checks. E2E class declarations use erasable fields, not parameter properties, because fixtures also load through Node's strip-only TypeScript support. Parsed link evidence is validated from `unknown` and requires literal-`true` attestations. Go build/vet/test/format checks remain blocking; the existing broad Go style-lint profile remains advisory rather than weakening its rules or claiming the backlog is clean.

Native Wails capability contracts run with
`GOWORK=off node --test scripts/wails-tool.test.mjs` in the existing bindings
freshness job after Task generation. They authenticate real pinned executables
and reject altered, foreign or redirected capabilities. Fast selector contracts
remain Go/Task-free; generated-binding freshness and actual application execution
exercise generation and its consumers.

`task fmt` and `task check:fmt-check` select tracked and nonignored Go source through Git, preserving spaced filenames with NUL-delimited arguments. Both use `goimports` for formatting and imports; they never traverse ignored `node_modules`, prepared Wails sources or other tool caches.

See [worktree lifecycle](development-worktree-lifecycle.md), [package linking](development-package-linking.md), [build/watch graph](development-watch-graph.md), [instance profiles](development-instance-profiles.md), [sessions](development-sessions.md), [baselines](development-baselines.md) and [authenticated control](development-control.md) for producer contracts and platform evidence.

## CI dependency payload caches

Actions restores native Go module/compiler and pnpm content-store payloads using
the participating host, SDK, UI and plugin dependency inputs. UUID-owned host
compiler caches remain isolated. Installed trees, profiles, source outputs and
ownership receipts are not restored from these caches.
Go payloads use an exact dependency key with a fallback confined to the same
Linux image, architecture and resolved Go version. Native Go validates reusable
objects when dependencies change. Successfully restored/produced Go payloads
are saved independently of browser assertions; an assertion failure must not
discard dependency/compiler work. Cancellation does not publish a new cache.

The PR Go and bindings jobs capture `go env GOCACHE` after `actions/setup-go`
restores its cache and pass that absolute path as `GO_BUILD_CACHE_DIRECTORY`
to every Task invocation. `task check:go-cache` verifies the effective Go cache
matches before verification starts. Standalone and workspace defaults remain
unchanged; an explicit cache override must be nonempty and absolute.

Linux development headers remain required by the pinned Wails transitive cgo
dependencies even for server builds. CI caches only their downloaded `.deb`
archives, keyed by platform, recipe and fresh APT index contents. Before
privileged installation, `scripts/verify-apt-archives.mjs` checks package identity,
size and streamed SHA-256 against those authenticated indexes. Native APT
installation still runs. Successful package installation publishes this payload
cache before browser execution; it does not certify application acceptance.

The host React compiler processes owned source, including runtime and benchmark
sources, rather than reprocessing built dependency/distribution bundles. Actual
compiler/render regressions run on Linux and native Windows.
Managed live delivery scans the actual linked publication and runtime entries
before initial dependency optimization. The cold-browser journey requires one initial document,
no optimizer HTTP failures, actual plugin rendering and same-origin reconnect.

