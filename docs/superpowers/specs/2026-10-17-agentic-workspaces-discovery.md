# Agentic development workspaces: discovery and proposed design

Date: 2026-10-17
Status: research complete; proposed architecture, not approval to implement.
Implementation work packets: [ordered plan](../plans/2026-10-17-agentic-workspaces.md).

## 1. Recommendation

Introduce a **named development workspace** owning a manifest, feature worktrees, an isolated application profile, dependency overrides, ports, processes, and verification endpoints. Keep production's state lock. Add scriptable control over the existing host plugin/settings services rather than a second implementation of those operations.

Use a host-owned `omniview-dev` executable with Taskfile entry points. Preserve separate pnpm workspaces and `GOWORK=off`; link selected UI/SDK/host-package worktrees explicitly. The host's managed plugin lifecycle is the supported workspace path. Multiple different plugins run in one workspace; different versions of the same plugin ID run in different application instances.

Use two verification surfaces:

- **Server mode + Chromium/Playwright** for browser-visible full-stack behavior, optionally proxying Vite assets for development.
- **Native application MCP** for the real WebView and native-window behavior. MCP DOM snapshots are structural, not pixel screenshots.

Do not claim full isolation until SDK filesystem escapes, native webview persistence, inherited plugin compatibility, and process ownership are addressed. A state-directory environment variable alone is insufficient.

## 2. Scope and evidence classification

Requested outcomes: production singleton; named concurrent dev apps; visible workspace identity; isolated data/settings/installs/browser state; safe baseline import; feature worktrees across host/UI/SDK/multiple plugins; local Go/JS linking and live feedback; managed ports; noninteractive lifecycle/plugin/settings control; token-efficient agent skills; browser/native verification; dependency-ordered parallel implementation.

This change is documentation only. Discovery used source inspection, primary documentation, temporary binaries/state, real browser interactions, and native MCP. No production state contents, real plugin backends, credentials, or clusters were intentionally opened. Existing checkout topology was not rearranged. The probes used installed frontend dependencies and existing `dist`; they are not proof of a clean frontend build or plugin compatibility.

In this document:

- **Observed/source:** directly established by repository or pinned dependency source.
- **Observed/runtime:** exercised in this research session.
- **Proposal:** a recommended contract, not an existing command or guarantee.
- **Unverified:** needs the named implementation gate; no implied passing result.

## 3. Repository and ownership map

Paths are relative to the developer's configured repository root, currently `~/Repos/omniviewdev`. Do not embed this machine's absolute paths in versioned config.

| Repository ID | Current source checkout | Important areas | Ownership |
| --- | --- | --- | --- |
| `omniview` | `omniview/`, ordinary clone | `main.go`, `app.go`, `internal/appstate`, `internal/settings`, `internal/bootstrap`, `backend/pkg/plugin`, `ui/features/plugins`, `ui/layouts`, `packages`, `build`, `e2e` | Application, runtime/providers/Vite-plugin packages, workspace CLI/control |
| `ui` | Git repo `ui/.bare/`; working tree `ui/main/` | `packages/base-ui`, `packages/ai-ui`, `packages/editors`; `docs/ARCHITECTURE.md`, `docs/TOOLING.md` | Shared components, styles, editors, AI UI |
| `plugin-sdk` | `plugin-sdk/`, ordinary clone | `pkg/sdk`, `pkg/utils`, `pkg/config`, `settings`, `log`, `proto` | Plugin process lifecycle, state paths, RPC/types |
| `kubernetes` | `omniview-plugin-kubernetes/`, ordinary clone | `pkg/plugin`, `pkg/utils/kubeauth`, `ui`, `plugin.yaml`, `Makefile`, `hack` | Kubernetes backend/frontend and cluster tooling |
| Additional plugin | Explicit registered repo, plugin ID read from `plugin.yaml` | Repo-specific backend/frontend entry points | Any number of different selected plugin IDs |
| `omniview-cli` | Separate sibling repo | `cmd/root.go`, `cmd/plugin`, `internal/build` | Marketplace/publisher CLI, not local app control |

There are also historical `omniview.git/` and `plugin-sdk.git/` bare repositories, sibling feature worktrees, `ui/fix/*`, `ui/feat/*`, `.worktrees`, and a parent `go.work`. An origin URL/name is not enough to select a canonical Git repository. Record the actual common Git directory and base ref; leave existing worktrees untouched.

Evidence: sibling Git metadata and manifests; `package.json:6,29-33`; `go.mod:16-21`; sibling Kubernetes `go.mod:1-14`. Kubernetes' Go module is `github.com/omniview/kubernetes`, not its repository URL spelling.

## 4. Current state, locking, and isolation

### 4.1 What already works

- `internal/appstate/resolve.go:17-53`: `OMNIVIEW_STATE_DIR` > link-time `buildStateDir` > `~/.omniview`; explicit paths must be absolute and support `~` expansion.
- `internal/appstate/appstate.go:67-125` and `lock.go:11-22`: a nonblocking `<root>/.lock` is acquired by default.
- `main.go:65-96`: locking precedes settings, migrations, telemetry, Wails, and plugin startup. One cooperating host writer per root already includes production.
- Host settings, installation directories, plugin data/connection stores, and logs mostly receive the state service.
- Nightlies deliberately select `~/.omniview-nightly` through ldflags (`.github/workflows/nightly.yaml:113-121`). Preserve this channel; `version.IsDevelopment()` is not a reliable workspace/profile selector because packaged nightlies also set it true.

### 4.2 Required gaps

| Gap | Evidence | Required outcome |
| --- | --- | --- |
| Normal dev falls back to production | `Taskfile.yml:30-39`; `resolve.go:18-31` | Dev launcher resolves a profile explicitly and never silently selects production |
| SDK ignores state root | SDK `pkg/utils/store.go:10-58`; `pkg/sdk/devinfo.go:27-34,89-139` | Host, SDK, runner, store/discovery cleanup share the resolved root |
| Programmatic root not propagated | `backend/pkg/plugin/loader.go:257-270` inherits environment but does not inject resolved state root | Always pass canonical absolute root to children, even if selected by ldflags/config |
| Identical macOS dev/prod identity | `build/darwin/Info{,.dev}.plist:26-29` | Distinct dev bundle identity/display name for every workspace |
| Browser keys not profile-scoped | `index.html:25-43`, `ui/theme/themeBootstrap.ts`, homepage cards, bottom drawer, resource-table preference keys | Profile namespace from first paint, plus separate native webview storage |
| Generic development label only | `AppStatusFooter.tsx:67-76` uses `import.meta.env.DEV` | Runtime-derived `DEV · <name>`, visible even in optimized dev-profile builds |
| State copier is not safe | `backend/pkg/plugin/copy.go:20-60` follows `os.Stat` symlinks | Dedicated allowlist exporter/importer; no recursive copy of live profile |
| Cleanup trusts copied numeric PIDs | `backend/pkg/plugin/pids.go:73-126`; `devserver/ports.go:135-180` | Exclude runtime records from baselines; prove process generation/ownership before termination |

`WithRoot` bypasses the environment resolver's validation. Root identity must canonicalize aliases/symlinks and reject overlapping/production destinations; display names alone must not determine ownership.

`set logger to app.log` printed during probes is misleading text, not an observed cwd file escape: `backend/diagnostics/diagnostics.go:33-34`, `logger.go:57-67` actually select injected `logs/ui.log`; telemetry uses `logs/omniview.log`.

### 4.3 Limits of the promise

Application isolation is **not a sandbox**. Terminals and plugins run with user privileges. Source builds write selected worktrees, node_modules, and tool caches. Explicit exports can write user-selected files. `OMNIVIEW_STARTUP_REPORT` must be routed into the profile by the launcher.

Kubernetes defaults to `~/.kube/config`; AWS exec helpers and SSO/cache behavior remain external. Helm code selects user-default repository config and can modify it (`pkg/plugin/helm/repo_resourcer.go`); route application-owned Helm config/cache/data into the profile. Helm releases and Kubernetes operations modify real cluster state. Distinct profiles do not isolate a shared remote cluster/account. Do not rewrite HOME automatically; offer explicit dedicated test credentials/contexts/clusters instead.

An old marketplace binary embeds its old SDK. Fixing the local host/SDK does not retrofit it. Baselines must not auto-start unverified imported executables under an isolation claim. Rebuild with the fixed SDK, or install an artifact with verified supported isolation provenance; otherwise report it unsupported/disabled.

## 5. Baseline policy

**Proposal:** default baseline = selected nonsecret preferences plus an install/version manifest, not the source state tree.

1. New, stopped development destination only. Reject source=destination, aliases, nesting, symlinks, production destination, or an already initialized destination.
2. First implementation uses an **offline consistent source**: require source stopped and acquire its existing flock. Fail clearly when busy. Live logical export can be added only through an explicit transactional source API; raw copying live bbolt is forbidden.
3. Do not call current `settingsstore.Open` on source: it opens writable, creates buckets, and can rename corrupt DB files (`store.go:64-101`). Open source read-only under its lock; migrate only private staged copies of legacy GOB.
4. Default allowlist: nonsecret general/appearance/editor/terminal settings. Exclude telemetry enablement/auth/export destinations, credentials, unknown plugin values, arbitrary plugin data, connections/autoconnect, terminals, and sessions. Explicit additional import policies require schema classification and redaction.
5. Always exclude `.lock`, `plugin_pids.json`, `devserver_pids.json`, `.devinfo*`, control endpoints/tokens, caches, logs, temporary files, native/browser profiles, and source dev-worktree paths.
6. Export plugin IDs/versions/provenance. Reinstall independent compatible artifacts; map selected local plugins to destination worktrees. No hardlinks or symlinks into source state. Imported plugins stay inactive until compatibility and isolated-root support are established.
7. Stage under a private destination sibling, validate, then atomically finalize. Preserve source bytes and record only nonsecret provenance/exclusions.

Connections automatically start watches in current code (`resource/controller.go:278-284,1488-1553`); copying connection data is not passive. Never make it the default.

## 6. Linking and live feedback

### 6.1 Existing graph

| Consumer/library | Current contract | Implication |
| --- | --- | --- |
| Host | pnpm `10.34.7`; own providers/runtime workspace packages; published UI deps | Keep host workspace boundary |
| UI repo | pnpm `10.6.2`; base-ui, ai-ui, editors use dist/CSS/type exports and internal workspace peers | Install/build within UI workspace; do not flatten into host |
| Host runtime | Dist package exports root, `/api`, `/models`, `/runtime`; host Vite aliases all to source | Plugins still need matching dist/types and correct subpath resolution |
| Host Vite-plugin | Builds shims from resolved runtime bundle, then package | Runtime build must precede Vite-plugin generation/check |
| Plugin frontend | Kubernetes consumes published runtime/Vite-plugin/UI | Override every selected consumer, not host alone |
| Host/plugin Go | SDK versions differ: host `v0.5.0`, Kubernetes `v0.4.0` | Local replacement may uncover real API incompatibility |

Sibling UI main versions are below current host ranges; host runtime/Vite-plugin workspace versions also differ from Kubernetes ranges. Verify resolved paths and exports, not version-string satisfaction.

Evidence: host `packages/*/package.json`, `vite.config.ts:58-84`, `Taskfile.yml:175-180`; UI package manifests/Vite configs; Kubernetes `ui/package.json`.

### 6.2 Recommended mechanism

- Explicit, workspace-owned per-consumer pnpm overrides to selected package directories. Start with path links preserving separate source workspaces and their package managers; validate peer/singleton/CSS behavior before fixing the protocol in implementation. `file:` has different peer/install semantics and rebuild-by-atomic-rename behavior must be tested. This is a real feasibility gate, not a choice to guess.
- No global `pnpm link`, parent super-workspace, incidental ancestor `go.work`, or mutation of canonical checkouts.
- Use worktree-local Go `replace github.com/omniviewdev/plugin-sdk => <selected SDK worktree>` in each actual consumer's go.mod, with an owned reversible edit journal. This keeps normal Go, bindings, and IDE resolution aligned under `GOWORK=off`, rather than a process-global GOFLAGS modfile accidentally applied to the wrong module. Preserve user-authored replacements; fail on conflicts.
- Journal generated pnpm overrides/lockfile and Go manifest/sum changes by original/applied content hashes. Unlink restores only unchanged tool-owned edits; never reset later user edits. Report a merge conflict instead.
- `task dev` must stop running `ui:update` implicitly. Registry upgrades remain an explicit maintenance task.
- Build base-ui before dependent UI libraries; providers/runtime before Vite-plugin shims; then selected plugin UIs/backends. Dist exports, declarations, CSS and `shims/` must all exist before launch.
- Add library build watchers and resolved SDK dependency watchers. Current standalone runner watches plugin `pkg/`; managed watcher reads source-local `go.work` and watches dependency `pkg/` only. Neither covers SDK `settings/`, `log/`, `proto/` comprehensively.
- Preserve React/runtime singletons and the host CSS cascade. Keep `ui/features/plugins/api/shared_dependencies.ts` and `packages/omniviewdev-vite-plugin/src/sharedPackages.ts` in sync. Do not add MUI/Emotion/legacy UI compatibility shims.

Kubernetes `ui/package.json` uses `tsc --noEmitOnError false; vite build`; a successful final exit can mask type errors. Make this fail correctly before using it for agent verification. Kubernetes Makefile install paths hardcode `~/.omniview`; workspace orchestration must never invoke them unchanged.

## 7. Plugin management and control

### 7.1 Existing surfaces

- Host-owned nested-module CLI: `cmd/omniview-plugin-dev`: one foreground plugin; `--dir`, `--vite-port`, `--no-vite`, `--verbose`, `--version`.
- Backend manager: install archive/registry versions, load/reload/retry/uninstall/list; dev install uses a native directory dialog.
- DevServerManager: managed start/path/start-stop/restart/rebuild/state/logs.
- Host and plugin settings providers: schema/get/set/bulk and existing validation/persistence hooks.
- Sibling `omniview-cli`: marketplace auth/publisher profiles/build/submit/list, not installed-app plugin management. Local workspace operations must not acquire marketplace authentication accidentally.

### 7.2 Correctness gaps to resolve before exposing automation

- Extract a noninteractive `InstallDevPluginFromPath` transaction from `backend/pkg/plugin/installer.go:24-124`; native dialog and CLI both call it.
- Existing manager returns an already-started ID without checking changed source path (`devserver/manager.go:201-268`). Relink A→B must explicitly stop, rebind, rebuild/load, persist, and report completion/failure.
- External `.devinfo` currently marks connected by PID and emits status. Loader creates go-plugin with `Cmd`, not `Reattach`; no working external attach path was found. Runner/SDK both write discovery. Choose managed lifecycle for the workspace path, and migrate standalone runner use to a thin client of that lifecycle rather than building a third process manager or relying on false attachment. Remove obsolete external handshake-discovery code after documented callers are migrated.
- Readiness cannot mean merely built, PID alive, or Vite port positive. Require actual reachable Vite, connected lifecycle RPC, and initialized controllers; UI-only plugins report backend not-applicable.
- `InstallPluginFromPath` defers deleting its input archive (`installer.go:248-249`). Separate caller-owned persistent input from temporary download ownership before a public CLI exposes it.
- Sensitive settings must be redacted at the control boundary; unknown plugin schemas are not evidence of safe values.

### 7.3 Proposed control boundary

One dev-only loopback HTTP service with a per-instance high-entropy bearer token, strict origin/host handling, private discovery/token files, and a versioned narrow operation allowlist. Reuse backend services; no arbitrary shell endpoint and no second settings/install store. Compile it out of production releases; do not infer enablement from frontend DEV or nightly Development flags.

`omniview-dev` exposes separate `workspace`, `instance`, `plugin`, and `settings` command groups. Explicit `--workspace <name-or-manifest>` wins; otherwise resolve the enclosing workspace manifest. Missing/ambiguous workspace is an error, never production fallback. JSON stdout, diagnostic stderr, stable exit codes, operation IDs, timeout/wait semantics, and redacted output are required.

Managed lifecycle migration replaces the standalone runner's user-facing workflow. Marketplace CLI remains independent; do not overload marketplace `plugin list` or publisher profiles.

## 8. Filesystem and command contract (proposed)

```text
<root>/
  .omniview-dev/repositories.json       # local source registry; no credentials
  workspaces/<slug>/
    workspace.json                     # portable intent + immutable workspace UUID
    .local/                            # ignored machine paths, leases, logs, edit journal
    omniview/                          # feature worktree, always included
    ui/                                # optional selected feature worktree
    plugin-sdk/                        # optional selected feature worktree
    omniview-plugin-kubernetes/         # zero or more selected plugin worktrees

~/.omniview-dev/profiles/<workspaceUUID>/state/
~/.omniview-dev/profiles/<workspaceUUID>/runtime/
~/.omniview-dev/profiles/<workspaceUUID>/webview/
```

User config sets root once; initial registry explicitly distinguishes `ui/.bare` from `ui/main`. Existing clones need not move. Future contributors may use ordinary clones at `<root>/<repo>`; registry validation supports both layouts. Slug validation: lowercase ASCII letters/digits with interior single hyphens, 1–48 characters, no separators/traversal. UUID identity is stable across rename; branch convention `feature/<slug>-<shortUUID>` avoids already-checked-out branches. Base refs are explicit per repo and pinned to commits in the resolved manifest. Git operations use registered Git roots, not guessed `.git` layouts.

The two roots are intentional: `<root>` is the configurable source collection; the default **global per-user profile root** is `~/.omniview-dev/profiles/<workspaceUUID>`, independent of collection location. `OMNIVIEW_STATE_DIR` selects its `state` child, not the profile container. The same resolved profile descriptor controls state locks, runtime and webview storage for the host and children. The current [operational guide](../../development-workspaces.md#settings-baseline-and-custom-state-roots) also supports an explicit machine-local custom state binding; do not infer one from `--root`.

UUIDs are globally unique within the user's profile/ownership registry, not collection-local counters. Copying a manifest into another collection must not create a second independent owner of its profile: validate durable ownership and fail conflicting/live claims. Leases and process generations remain UUID-qualified, and collection moves retain UUID/profile identity only through the controlled stopped-workspace move/rebinding protocol; changing `--root` alone neither migrates profile data nor authorizes an alias owner. Baselines export/import sanitized settings, never live leases, locks, tokens or runtime/webview state. Backup and any explicit profile migration require a stopped, ownership-verified source and destination, preserve UUID and custom-binding metadata, and must not leave two writable owners. Ordinary collection removal retains profile data; explicit profile purge verifies UUID/path ownership and no live generation, and never recursively deletes another collection's state.

Example future commands — **not implemented**:

```sh
task workspace:init -- --root "$HOME/Repos/omniviewdev"
task workspace:create -- resource-graph --repo ui --repo plugin-sdk --plugin kubernetes --start desktop
task workspace:up -- resource-graph --mode browser
task workspace:list -- --json
task workspace:inspect -- resource-graph --json
task workspace:edit -- resource-graph --add-plugin another-plugin
task workspace:down -- resource-graph
task workspace:remove -- resource-graph
```

CLI equivalents use `omniview-dev workspace ...`. `create --start` performs create → link → bootstrap → optional seed → launch → readiness, with resumable owned-operation state. Host-only/no-plugin workspaces remain valid; selected SDK/UI worktrees are optional, but selected plugins must satisfy the fixed-SDK isolation requirement.

Required lifecycle verbs: init/create/list/inspect/paths/edit/link/unlink/up/down/remove. `edit` changes repo/plugin selections, source refs or display name while preserving UUID; it is not an arbitrary editor/shell launcher. Removing dirty/foreign worktrees fails. State and branches are retained by default; explicit stopped-profile purge/owned-branch deletion options are separate destructive actions. No forced checkout/reset/clean of user changes.

Portable manifest tracks repo IDs/relative worktrees/base commits, selected package/module mappings, plugin IDs, profile policy and desired ports. `.local` records absolute paths and transient process state. Inspect reports both intent and actual resolution, including divergence/compatibility errors; no secrets.

## 9. Port and process contract (proposed)

Current ports:

| Listener | Current behavior | Change |
| --- | --- | --- |
| Host Vite | 9245; strict; IPv4 | Workspace-assigned, actual endpoint published |
| Server mode | App default 34115; `WAILS_SERVER_PORT` works | Workspace-assigned; use 127.0.0.1 consistently |
| Managed plugin Vite | First free 15173–15272, in-process allocator | Cross-workspace leases keyed by workspace UUID/plugin ID |
| Standalone plugin Vite | Prefers 15173, Vite increments, stdout parsed | Migrate to managed contract; no invisible drift |
| App MCP | Default 9099; port 0 supported | Dev opt-in, auth, actual endpoint discovery |
| CLI MCP | `wails3 mcp`; port 0 supported | Optional lifecycle adapter, confined to selected worktree |
| go-plugin RPC | Dynamically allocated handshake address | Record actual address; no invented fixed gRPC port |
| React DevTools | Hardcoded localhost:8097 script | Optional/configurable; absent by default for unattended workspaces |
| Storybook | UI/plugin scripts use 6006/6007 | Include in allocator when launched, not always-running services |
| kind ingress | Kubernetes config maps host 80/443 | Parameterize for workspace test-cluster profiles |

Use sticky, persisted allocation, not a supposedly collision-free hash. A service key is `(workspaceUUID, role, pluginID?)`. Preferred ports derive from that key in a configurable managed range, initially 20000–44999. A root-level locked lease registry serializes cooperating allocation; existing assignments stay stable across reorder/add-plugin/restart. Occupied preferred ports are reassigned predictably and the actual endpoint becomes authoritative. An explicit `--strict-ports`/pinned override fails rather than reallocating.

Check-and-close is not an OS reservation. Children must bind strictly, startup must verify ownership/readiness, and an external bind race must cause bounded reallocation or a clear error. Never kill an unrelated port owner. MCP may use port 0 directly; server mode in pinned Wails treats zero as default 8080, so do not assume identical semantics.

Every runtime record includes workspace/instance UUID, generation, PID plus start identity, role, executable/source identity, and actual endpoints. Cleanup is ownership-checked, idempotent, and cannot kill an unrelated reused PID or another workspace. Health alone is insufficient identity: connect to the descriptor and compare UUID/generation before mutation.

## 10. Wails research and runtime findings

### 10.1 Primary sources and pinned availability

1. [Server builds](https://v3.wails.io/guides/server-build/): `server` build tag, HTTP bindings/events, `/health`, environment overrides, native API differences.
2. [Application MCP](https://v3.wails.io/guides/mcp-service/): `mcp` tag; DOM/JS/input/bound-method/event tools; loopback/token configuration; `WAILS_MCP_PORT=0`; experimental API.
3. [CLI MCP](https://v3.wails.io/guides/cli/#mcp): separate project lifecycle service, stdio/HTTP, root confinement, authentication, no arbitrary shell tool.
4. [Single instance](https://v3.wails.io/guides/single-instance/): `SingleInstanceOptions`, unique ID, second-instance forwarding, untrusted launch data.
5. [pnpm 10 linking](https://pnpm.io/10.x/cli/link): path linking versus `file:`, peer/dependency differences. Do not use latest pnpm documentation as proof of pinned 10.x behavior.
6. [Go module reference](https://go.dev/ref/mod): main-module replacements; do not depend on ambient parent workspaces.

Installed CLI, host Go module, and frontend runtime are all Wails `3.0.0-beta.29` (CLI version exercised). Pinned module source contains server mode, both MCP services, singleton options, server environment overrides, and dynamic MCP ports. No Wails upgrade is required merely to begin this work.

Pinned source references below are relative to Wails module `github.com/wailsapp/wails/v3@v3.0.0-beta.29`:

- `pkg/application/application_server.go:68-84,120-127,206-225`: host/port overrides, bind, health/events/streams. Server port parser rejects zero; configured zero becomes 8080.
- `pkg/application/mcp_enabled.go:61-141`: MCP listener/config/token and actual logged endpoint.
- `internal/commands/dev.go:45-58`: sets `WAILS_VITE_PORT`, `FRONTEND_DEVSERVER_URL`, `EXTRA_TAGS`.
- `internal/assetserver/build_dev.go:67-120`: reverse-proxies Vite with `FRONTEND_DEVSERVER_URL`.
- `pkg/application/application.go:203-216,554-568`: singleton initialized in application.New; services may be registered before Run.
- `pkg/application/application_options.go:279-283`: Windows WebView user-data path exists.
- `pkg/application/webview_window_darwin.go:137-196`: default WKWebViewConfiguration; no profile data-store selection observed. Unique macOS bundle IDs and storage separation need an actual packaged-app gate.

### 10.2 Probes actually exercised

| Probe | Result | Limit |
| --- | --- | --- |
| `GOWORK=off go build -tags server,mcp -o /tmp/omniview-workspace-discovery-server .` | Built and launched with temporary state | Used existing dist; no clean frontend build |
| Two server processes, separate temporary roots, ports 34115/34116 | Both served app/health concurrently | Not production + two packaged desktop apps |
| Duplicate launch against first root | Exit 1, `another instance holds the lock` | Existing per-root lock, not OS activation behavior |
| Chromium opened real app; edited Terminal font size and saved | First backend returned 17; second returned 12 via real Wails binding | No plugins installed; not all state domains |
| App MCP with port 0 | Actual loopback endpoints allocated and app_info returned | Server-mode JS eval against synthetic main timed out after 1s |
| `GOWORK=off go build -tags production,mcp -o /tmp/omniview-workspace-discovery-native .` | Native macOS app launched; app_info showed visible main | Throwaway direct native binary, not a release; development version defaults retained |
| Native MCP js_eval/dom_query/mouse_click | Real `wails://localhost/` shell found; clicked Settings; category list visible | No native pixel screenshot or cross-profile storage proof |
| Vite 34245 + server 34118 with FRONTEND_DEVSERVER_URL | Source app rendered; real settings category loaded; Vite connected | HMR used direct-WebSocket fallback; no source-change or linked-package HMR probe |
| `task --dry darwin:build DEV=true EXTRA_TAGS=mcp` | Printed Go build without mcp tag | Existing platform task drops EXTRA_TAGS; direct build working does not prove task-based MCP enablement |
| `wails3 mcp --help` | Root/stdin/HTTP/port/token flags available | Did not operate lifecycle MCP server |

Visual browser screenshots were inspected. All temporary applications/browser tabs/services were stopped after discovery. No full test suite was run; this was an investigation, not implementation validation.

### 10.3 Browser/native issues that must be tracked

- Vite's Wails plugin adds typed-event integration, not a complete backend proxy. Opening Vite alone is not full-stack proof. Browser tests target the server-mode backend URL, which proxies Vite when requested.
- Current HMR configuration has no explicit browser-proxy client port. Observed fallback connects successfully, but configure the actual Vite HMR endpoint rather than depend on fallback. Validate a real source edit later.
- Current source app emits Wails' generic browser-preview warning even when accessed through a functioning server backend. Treat capability/round-trip checks, not that warning or `window._wails` existence, as readiness evidence.
- React DevTools at localhost:8097 refused connection during hot-browser probe; do not require this listener or leave an unconditional script for unattended runs.
- An aborted HEAD for `/wails/custom.js` was observed without preventing shell/backend operation; investigate/triage against a clean build rather than suppress network errors globally.
- App MCP JS eval does not operate the external Chromium page through the synthetic native main window in the exercised server build. Use browser automation there; use native MCP in desktop mode.
- `screenshot_dom` is structural; native pixel validation needs a separate screenshot capability. Server-mode screenshots do not establish native titlebar, dialogs, drag regions, clipboard, menus, webview storage, or OS integration correctness.
- Current e2e baseURL/health port are fixed; `reuseExistingServer: true` can select the wrong process. Existing fixtures mutate real server settings and close terminal sessions. Never point them at a human's dev instance accidentally.
- Existing March e2e design includes Wails v2 assumptions; current configuration is server-mode v3. Update operational docs rather than copying the old design.

## 11. Agent skills (proposed, not installed by this research)

Version canonical skills in host `.agents/skills/`; provide a documented installation/registration task for supported agent clients. Do not depend on this machine's parent `.claude` directory. Generate client adapters from one source rather than maintaining duplicated skill bodies.

| Skill | Trigger/output | Required content |
| --- | --- | --- |
| `omniview-repo-map` | Finding owner repo/files for an Omniview task | Small routing table from §3; package/module/plugin IDs differ; resolve current workspace paths through inspect before searching; load per-repo references only when relevant |
| `omniview-workspaces` | Starting/resuming/editing/removing feature work | One-command create/up; explicit repos/plugins/refs; reuse existing workspace; inspect resolved links/state/ports; no production fallback/global links; dirty-worktree and state-purge safety |
| `omniview-instance-verification` | Verifying UI/backend/plugin work | Resolve UUID/endpoints; readiness and compatibility; isolated browser contexts; server + native MCP distinction; screenshots/console/binding round-trip; no real cluster/credential mutation by default |

References contain exact commands and only the relevant maps. The main skill should not dump complete repository inventories. Agent reports include workspace ID, repo/branch, verified endpoint/generation, scenario, screenshot path where applicable, and explicit limits.

Skill acceptance is behavioral: from a fresh agent context, create a UI+SDK+two-plugin workspace, resume an existing workspace, route a settings vs component vs SDK issue correctly, detect a wrong endpoint, and refuse dirty removal or production fallback. Evaluate with/without skills and retain human-reviewable transcripts. Author actual skills only after the implemented CLI contract is stable.

## 12. Alternatives and decisions

| Approach | Benefits | Costs | Decision |
| --- | --- | --- | --- |
| Environment variables/manual worktrees/link commands | Small initial change | Inconsistent roots, peers, ports, cleanup, skills depend on hidden knowledge | Insufficient for one-command agent workflows |
| Named manifest + host-owned CLI + existing managed plugin lifecycle | One local contract; narrow control surface; incremental repository adoption | New orchestration/control code; explicit schema/ownership work | Recommended |
| One pnpm/Go super-workspace or containers for everything | Central dependency graph or stronger process isolation | Conflicts with GOWORK=off, heterogeneous package managers/native Wails, existing topology | Not default; no requirement to migrate clones or containerize desktop |

The recommended local CLI stays in the host repo rather than the marketplace CLI so feature work does not require another clone, marketplace credentials, or a second release cadence. A future marketplace CLI can invoke the same control protocol without owning business logic.

## 13. Approval and execution gates

The companion plan defines work packets and dependencies. Before implementation, review the proposed manifest/CLI ownership, managed-runner cutover, offline baseline policy, sticky-port policy, and per-workspace native identity.

Hard gates before claiming the user goal delivered:

1. Packaged native storage isolation established; patch/pin Wails support if unique identity is insufficient on supported platforms.
2. Fixed SDK used by selected plugins; no unsupported imported executable auto-start.
3. Local package link + dist replacement/watch + singleton/CSS behavior actually demonstrated on pinned pnpm versions.
4. Production + two named desktop instances, same plugin ID in different instances, and at least two different plugins in one instance exercised end to end.
5. Browser/server and native MCP verification select the intended UUID/generation; no false readiness.
6. Safe lifecycle remove/edit/import/cleanup demonstrated without affecting another workspace or canonical clones.

Windows/Linux webview storage, singleton behavior and process ownership require their platform CI/manual evidence. This macOS research does not establish those outcomes.

## 14. Approved pnpm12 amendment

The developer requested native **pnpm12.14.0**, approved explicit `minimumReleaseAge: 0` to preserve prior immediate-release behavior, and subsequently approved **one managed pnpm workspace per feature**. This supersedes this discovery's independent-install-root assumption, not Git/Go/profile isolation.

Actual stock12 builds/installations succeeded, but its linked-peer checker rejects provider metadata outside a lockfile root. A private shared virtual store alone failed a non-wildcard runtime/UI peer. A disposable single-feature workspace preserved actual React/ReactDOM identity and atomic output visibility; a cold incompatible React peer was rejected. A warm install can skip peer re-audit, so explicit **recursive** `pnpm -r peers check --json --lockfile-only` and manifest freshness are required.

The generated aggregate root is the registered feature directory above selected worktrees. Preserve source configs/locks for standalone use, explicitly reconcile aggregate policies, maintain controlled output lifetimes/restoration, and retain stock12 without forks, downgrade or relaxed peer checks. Authoritative native `PNPM_CONFIG_WORKSPACE_DIR` preserves package cwd/argv while overriding nearer nested YAML; validate its canonical scope and clear inherited aliases before use.

The developer additionally approved host-led convergence of incompatible shared lock snapshots: host first, selected UI next, remaining source locks in stable relative-path order. This permits necessary transitive-edge convergence within the generated feature graph, not a general dependency update or changes to standalone source locks. Distinct locked identities/integrities remain seeded, same-key integrity conflicts still fail, seed choices are inspectable, and native installation plus recursive peers determine the actual final graph.

The developer confirmed the host's bundled AWS/containers/testUI frontends are unused and may be ignored. Remove their broad `plugins/**` host workspace membership without deleting their files; explicitly selected registered plugin repositories still join each feature. This avoids turning managed workspace setup into an unrelated migration of unused frontend dependency cohorts.

Source lock authority follows actual workspace boundaries, not every nested lockfile left in a package directory. Compatible source refs are still mandatory: the selected UI feature now includes the existing base-ui0.4.3 release required by the runtime peer contract, rather than faking its version or weakening peers.

Native12's default pre-run dependency policy can attempt installation, warn on failure and still execute stale consumers. The owned launcher must enforce `verifyDepsBeforeRun=error` for `run`/`exec`: actual stale-graph refusal and unchanged lock bytes are part of the native protocol probe. The explicit owned install/recursive-audit transaction remains the dependency writer; checks are not disabled.

Implementation packets, exact shared interfaces, parallel ownership and acceptance are in [the pnpm12 composition plan](../plans/2026-10-17-pnpm12-feature-composition.md). Standalone12 build success is not managed launch acceptance; the original hard gates above remain.
