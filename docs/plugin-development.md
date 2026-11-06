# Developing Plugins for Omniview

This guide covers everything you need to know to develop plugins for Omniview with fast iteration cycles. You will learn how to set up your environment, choose a development workflow, and troubleshoot common issues.

### Marketplace host compatibility

Host registry API requests and local plugin compatibility checks use
`internal/version.CompatibilityVersion()`. Stable release builds automatically
advertise their linker-stamped release version, normalized without a leading `v`
or build metadata. Releasing a new stable patch does not require a second version
constant to be updated.

Development, nightly, prerelease, and non-version build labels use the explicit
source capability baseline (`0.30.2`). Advance that baseline when development
source gains a coordinated host/runtime/SDK capability; do not derive capabilities
from labels such as `0.0.0-nightly...` or `pr-build-macos`.

Transactional settings require rebuilt SDK v0.10.0 plugins; Kubernetes v0.11.0
requires host/runtime v0.14.0.
Plugins using write-only connection-profile credentials require host/runtime v0.20.0
and must declare an inclusive `min_ide_version` of `0.20.0` or newer.
Kubernetes v0.15.0 declares a minimum host version of v0.27.1.
Kubernetes v0.15.1 requires host/runtime v0.27.2 and SDK v0.14.6 for native
streaming log clients and completed-source handling, alongside Base UI v0.12.0.
Its marketplace submission declares an inclusive `min_ide_version` of `0.27.2`.
Activity-enabled plugin releases require host/runtime v0.30.0 or newer and use
Base UI v0.14.0 with SDK v0.15.0. Older stable hosts do not expose activity hooks
and reject the new resource-action stream field. Declare `min_ide_version: "0.30.0"`
in marketplace publication metadata, not in `plugin.yaml`.

The Base UI `0.15.0` cohort requires host/runtime and Vite plugin `0.30.2` or newer.
It pairs with editors `6.2.0` and AI UI `6.1.9`. Runtime's base-ui peer range is
`~0.14.0 || ~0.15.0`, preserving existing consumers during staged upgrades.
Older runtime releases require the previous UI minor. Plugins using
this cohort must declare `min_ide_version: "0.30.2"` in marketplace metadata.
The host and Vite plugin share `@omniviewdev/base-ui/metrics` as a separate entry,
so plugins can use its presentation components without bundling another UI copy.

Publisher minimum and maximum IDE versions are inclusive semantic-version bounds.
Hosts that omit `ide_version` can only access unconstrained plugin versions.
Artifact and CDN URLs, including signed URLs returned by download endpoints,
are not decorated with the host version.

Version history requests opt into `include_incompatible=true` to show newer public
releases with an explicit compatibility reason instead of hiding them. The host
checks inclusive minimum/maximum bounds against its compatibility baseline and
sorts all pages by semantic version. `discovery_supported` is true only when the
marketplace acknowledges this metadata-only mode with
`X-Omniview-Incompatible-Versions: true`; an older API may still omit incompatible
releases. Exact-version lookup and download requests never opt into discovery
and continue enforcing compatibility before artifact access.

Structured runtime errors preserve the outer operation title and render nested
public causes as readable text, including JSON escaped through Wails or prefixed
by Go operation context. Raw diagnostic prefixes, malformed structured causes,
and sensitive provider fallback fields remain hidden.

The public marketplace API is `https://mkt.omniview.dev`. Explicit
`developer.marketplace_url` overrides remain unchanged. Existing profiles that
saved the retired `api.omniview.dev` default must update that setting.

### Rich activity notifications

Use `useNotifications().notify({ title, severity, details, actions })` for UI
diagnostics. Trusted callback actions remain in memory for the current session;
they are never serialized into host activity records. Error helpers
`showAppError` and `createErrorHandler` accept this object-based `notify` function.
`actionToNotification` omits unsupported retries and unsafe documentation URLs.

Use `useActivityActions().startResourceAction({ pluginID, request, presentation })`
for adopted resource work. Keep canonical resource `Value` inputs intact,
including decimal-string integer values. The host owns stream attachment and
execution after adoption. Navigation, hiding a toast, collapsing a card, and
unmounting a resource view do not cancel work. Cancellation requires an explicit
request and remains pending until the producer reports an outcome.

Mount one `ActivityProvider` above runtime hook consumers. Mount one
`ActivitySurfaces` below the host theme and action contexts, inside the existing
`ToastProvider`; it projects one rich toast and the shared Notification Center.
Pass `onAction(action, record)` to `ActivitySurfaces` for typed navigation and
reviewed resource-action intents. Use `canHandleAction(action, record)` to omit
unavailable actions, such as resource navigation in a settings-only window.
The generic runtime never selects behavior by resource type or plugin identity.

The footer uses `useActivities().activeTasks` and
`useNotifications().notificationCount`. Both open the same center through
`openNotifications('active' | 'attention' | 'all')`. Collapsed and toast-hidden
state persist through the host; updates and completion do not reset them.
Overflow remains visible in the center. An open active row stays visible after
completion until the center closes. History clearing preserves active work and
firing alerts.

Cards show a status indicator and a measured progress bar with one compact count.
The bar uses canonical current/total values, animates value changes, and respects
reduced-motion preferences. Unknown totals remain indeterminate; completed units
do not independently mark the operation successful. Routine phase text, connection
identity, and extra metrics live in Details or status tooltips instead of repeating
below the bar. Failures and observation-loss states remain visible. Collapsing a
card preserves measured progress and its outcome indicator.

Plugin UI test configurations keep result and transform caches in a per-checkout
OS temporary directory, outside supervisor-owned dependency trees.
`OMNIVIEW_TEST_CACHE_DIRECTORY` overrides that location. Use `--no-cache
--configLoader runner` for direct Vitest runs. Leave binding generation and
output-writing builds to the managed workspace supervisor, which invokes the
canonical `task bindings` task and builds runtime before Vite plugin shims.

Runtime observation uses `Subscribe`, a scoped event listener, then `Attach`.
Revisioned snapshots and removal tombstones prevent stale hydration from
restoring old state. One native-window-bound producer capability belongs to each
document; observing view remounts do not replace that document's producer identity.
A heartbeat covers only that producer's report-only tasks, never another window.
After lease expiry, observation and capability reconnect without replaying any
mutation or reviving unknown tasks. Adopted native tasks do not depend on the
browser's lifetime. Both unit and step progress use decimal-string current and
total counts; the UI calculates ratios without losing canonical integer precision.

If recording an adopted action's progress or terminal result fails, the host emits
an `activity/observation-error` diagnostic. The runtime shows safe, copyable text
without persisting another notification, changing the action result, or replaying
the mutation. Verify the actual remote outcome before retrying.

#### Host reporting and persistence

The host owns one profile-local activity history. Task execution, alert condition,
and presentation are independent: collapsing, reading, dismissing, snoozing, or
acknowledging a record does not finish work or resolve an alert.

Go plugins report tasks, messages, and keyed alert observations through
`plugin.Activities()`. The lifecycle protocol binds a separate process-scoped
reporter; it does not use delegated connections or synthetic resource events.
The host stamps plugin identity, fences retired process generations, and rejects
cross-plugin updates and intents. Use stable alert keys containing connection,
resource, rule, and dimension identity. Duplicate or older observations do not
change alerts. Only a newer recovery observation resolves a condition.

`ActionEvent.Activity` carries typed presentation independently of canonical
action output. Host-adopted resource actions persist their task before mutation
and reuse normal action admission and fresh descriptor checks. The admitted
descriptor selects finite RPC execution or native-ready streaming. Both execute
under the host's provider-generation lifetime, not the browser request.
Navigation and component teardown do not cancel them. Adopted resource actions
do not advertise remote cancellation: stopping an observation stream does not
cancel a rollout or other remote mutation. Provider pause or stop controls remain
reviewed typed resource actions. Generic tasks with a real cancellation contract
remain requested until an observed outcome; a request never proves rollback.

The frontend binding is `backend/pkg/activity.FrontendService`. Call `Subscribe`,
install the `activity/change/<id>` listener, then call `Attach`. Buffer changes
while attaching and apply only increasing revisions. Subscriptions own views,
not producers. The subscription ID also grants a document-scoped producer
capability bound to its native caller window. Generic producer methods take this
ID before their request. The root provider renews `Heartbeat(id)` every ten
seconds; report-only UI work becomes unknown after thirty seconds without
producer observation. Another document cannot renew that capability. Expired
capabilities require a fresh session, without replaying mutations. Native adopted
actions do not depend on this lease. Generic UI reports cannot claim plugin
source identity.

Bindings carrying presentation or action requests take strict encoded JSON
strings to preserve canonical resource values, including double negative zero:
`BeginTask`, `ReportTask`, `FinishTask`, `PublishMessage`, `UpsertAlert`, and
`StartResourceAction`. The runtime client performs this encoding.

History lives in an atomically replaced private `activities.json` under the
active profile state root. Restart marks unfinished tasks and firing alerts
unknown without replaying mutations. History retains at most 500 terminal,
message, or resolved records, while active work and unresolved conditions remain.
`ClearHistory` removes only eligible history.

The store validates schema version, record provenance, revisions, timestamps,
and canonical state before recovery. Activity files cannot exceed 16 MiB.
Admission bounds active tasks and unresolved alerts globally and per producer;
subscription and live producer identities also have finite limits. Retired
identities are removed rather than accumulated in an unbounded blacklist.


### Host drawer context

`BottomDrawerProvider` must wrap `RightDrawerProvider` in `ui/App.tsx`.
The right drawer renders plugin views beside its children, not inside them.
Reversing these providers leaves sidebar log and terminal actions using the
bottom drawer context's no-op defaults: backend sessions start, but no tab opens.
Global search still works because it renders inside the bottom drawer provider.

When checking sidebar actions, verify that Logs opens a log tab, Exec opens a
terminal tab, and Delete opens its confirmation dialog (then cancel it).
Container shell availability is separate from action dispatch.

The bottom drawer's collapsed height includes its 36px tab strip and both 1px
header dividers. Host sizing constants supply the strip and divider CSS variables;
change those constants together rather than setting independent minimum heights.
After a header sizing change, check minimize, drag-to-collapse, double-click,
and restored minimized windows: the full tab strip and controls must remain visible.

### Host-owned in-process backend lifetime

`backend/pkg/plugin/types.InProcessBackend` accepts `InProcessBackendConfig`
with capability providers, an optional `HealthCheck`, and an optional aggregate
`Shutdown`. Configuration is fixed at construction; the backend snapshots the
provider map without copying provider instances.

`Stop` immediately fences dispensing and health, invokes aggregate shutdown once,
and waits for it to finish. Concurrent `Stop` and `Kill` calls share that shutdown;
later `Stop` calls return its original error. `Exited` becomes true only after
shutdown completes. In-process `Kill` cannot terminate native code forcibly.

Callbacks run outside the backend state lock. Health checks may overlap shutdown
and must synchronize their own native state. Shutdown may inspect backend state,
but must not recursively call `Stop` or `Kill` on the same backend.

Aggregate shutdown must not duplicate cleanup already owned by capability
controllers. The resource controller and exec controller already close their
providers; the backend does not infer ownership from a provider's `Close` method.

### Trusted built-in plugins

Product composition supplies `plugin.NewCatalog([]plugin.CatalogEntry)` to
`plugin.NewManager`. Each entry contains ordinary SDK metadata, a
`FrontendModule` key for UI capabilities, and a `NewBackend(context.Context)`
factory for backend capabilities. The factory must construct a fresh provider
graph for each activation. Installed manifests cannot opt into this catalog.

`types.ComposeNativeBackend(types.NativeProviders{...})` binds native SDK
utilities to the resource provider's real connection registry. Resource utility
providers must implement the SDK connection-context consumer contract. Direct
adapters dispatch canonical resource operations through the SDK's native resource
interfaces, just as the external transport does; they do not fall back to legacy
resource-data callbacks. Existing host reference admission and catalog pins still
apply.

Built-ins appear in `ListPlugins` before activation, with `origin: "builtin"` and
their trusted `frontendModule`. `LoadPlugin` activates them without an installed
manifest, binary, or asset directory. Discovery and enabling do not activate them.
`SetPluginEnabled` persists the preference independently from activation; disabling
retires controllers before releasing aggregate native resources.

| Resource owner | Cleanup responsibility |
| --- | --- |
| Resource controller | Retire admission, generation-bound work, and the resource provider |
| Exec controller | Close sessions and cancel/drain its forwarding worker |
| Logs controller | Close supported native providers, cancel/drain forwarding, retire buffered output |
| Metrics controller | Cancel/drain connection streams and retire subscription interests |
| Network controller | Stop provider sessions and port forwards |
| Settings/tools controllers | Retire their host registrations and pending host work |
| Aggregate `Shutdown` | Release shared native clients not already owned by controllers |

Product-owned IDs cannot be replaced through marketplace, local archive,
development-link, or uninstall operations. An existing external installation with
the same ID causes an explicit collision; the host does not delete or migrate
that installation implicitly. Built-in versions follow the application release.

Frontend composition registers a static import function and declarative route
metadata in `ui/features/plugins/adapters/builtinModules.ts`. The module key must
match the trusted catalog entry. Navigation or an explicit plugin-service load
activates the native backend, imports the module, and uses the normal export
validation and contribution pipeline. Unknown module keys fail closed without
SystemJS or development-server fallback. Disable, unload, and replacement fence
late imports so they cannot restore retired routes or contributions.

The production catalog and module registry are intentionally empty until the
separate containers migration. No sample or test feature ships with the app.
See [the integration plan](builtin-plugins.md) for
the containers, packaging, performance, and SSH/SFTP gates.

In a linked workspace, let the installed `omniview-dev` CLI run dependency
installation and producer builds; it invokes `task bindings` internally.
Standalone installs or producer builds can invalidate output ownership. Use
`workspace reset-modules` for changed dependency trees and `workspace recover`
for retained build recovery, rather than editing journals or weakening checks.

---

## 1. Getting Started

### 1.1 Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| Go | 1.24+ | Plugin backend |
| Node.js | 26.13.0 | UI development |
| pnpm | 9+ | Package management |
| Omniview | Latest | The IDE |

### 1.2 Plugin Structure

Every Omniview plugin follows this directory layout:

```
my-plugin/
  plugin.yaml          # Plugin metadata (required)
  pkg/                 # Go backend code
    main.go            # Plugin entry point (required for backend plugins)
  ui/                  # React frontend code
    package.json       # npm dependencies
    vite.config.ts     # Vite configuration
    src/
      entry.ts         # Plugin UI entry point
```

Installed plugin directories reserve `data/` and `store/` for runtime state.
Do not include either directory in a release archive; the host rejects those
packages before stopping the existing plugin. This includes case aliases on
case-insensitive volumes; case-distinct names remain valid on case-sensitive
volumes. Archive replacement moves the
existing state directories into the new installation without copying them, so
cached scoped roots and nested authority handles still address live state.
Failed publication moves that same state back before restarting the original
plugin. Runtime unload does not close appstate-owned roots; appstate closes them
when the application shuts down. Interrupted transactions retain their existing
recovery barrier and private staging evidence instead of adopting another path.

### 1.3 The `plugin.yaml` File

```yaml
id: my-plugin                    # Unique identifier (required)
name: My Plugin                  # Display name (required)
version: 0.1.0                   # Semver version (required)
description: A custom plugin
icon: LuPlug                     # Icon name or URL
repository: https://github.com/me/my-plugin
website: https://my-plugin.dev

maintainers:
  - name: Your Name
    email: you@example.com

# Plugin capabilities determine what interfaces your plugin implements.
# At least one capability is required.
capabilities:
  - resource    # Manages connections and resources (Kubernetes, AWS, etc.)
  - ui          # Has a frontend UI
  - exec        # Provides terminal/exec functionality
  - networker   # Provides port-forwarding/networking
  - log         # Provides log streaming
  - settings    # Has configurable settings (auto-included)

tags:
  - kubernetes
  - devops
```

For `exec` sessions, the host owns terminal tab state. When a provider supplies retryable shell errors and alternate commands, “Try a different shell” replaces the session in the existing tab, preserving tab order and focus. The host closes the old backend session; a failed retry stays in that same tab.

#### Fresh external resource shells (macOS)

The host's **Open in Native Terminal** action starts a new local CLI process in
Terminal or iTerm2. It preserves the selected resource reference and connection.
It does not move a running PTY, copy shell history or remote working directories,
or create a built-in terminal tab/session. Built-in Exec and shell retry behavior
remain unchanged. No modifier shortcut or default destination is configured.

`terminal.nativeApplication` accepts `terminal` (default) or `iterm2`. The action
is hidden outside macOS. The selected application must be installed; the host
never silently switches applications or falls back to built-in Exec.

Settings discovers installed supported terminal applications through macOS's
application registry. Display names come from each installed bundle and icons
come from `NSWorkspace`, rendered as 64px PNGs. Application choices are not a
static settings enum; only applications with an implemented safe launch adapter
are offered. Registering as a shell-document handler does not qualify an editor
or browser as a terminal. Discovery does not send Automation events or launch
applications.

The picker preserves its draft until Save Changes. Refresh applications rescans
the device without changing the draft. A removed saved application stays visibly
unavailable until the user chooses an installed alternative; discovery errors
remain distinct from an empty installed list. Availability is checked again at
launch. Existing `terminal` and `iterm2` preference IDs remain stable.

Plugins built with SDK v0.12.0 can provide `NativeCommandHandler` on an exec
handler, or implement the optional `exec.NativeCommandProvider`. Advertise native
support only when the handler can plan a fresh external process. Planning must
revalidate authoritative resource identity/incarnation and the selected connection,
reject unsupported authentication, and return structured `Executable`, literal
`Args`, optional `Env`, and optional absolute local `Cwd`. Plans must not include
tokens, passwords, or embedded credentials in any field. Use inherited local
authentication or reusable local credential-file references instead. An old plugin
or unsupported resource receives an explicit unsupported error, never legacy Exec.

The Wails service exposes `OpenNativeSession(plugin, connectionID, encoded)` and
`GetNativeTerminalSupport() bool`. The former accepts only the same bounded
resource-session JSON as built-in Exec, applies the same host reference admission,
and asks the plugin for its command immediately before launch. It is not a
frontend arbitrary-command API. Commands are not logged or returned to the UI.

Frontend plugins use `useNativeExec({ pluginID?, resourceKey })` from
`@omniviewdev/runtime`. It returns `isSupported`, `isPending`, and
`openNativeSession({ connectionID, opts }): Promise<boolean>`; `opts` is
`Partial<SessionOptions>` with the observed canonical body, reference, route, and
selected container. Plugin context supplies `pluginID` unless host code provides
it explicitly. Support requires both the backend platform check and the
handler's `supports_native_command` metadata. Hide native actions until support
is confirmed, disable them while pending, and close menus only on `true`.
Failures return `false` and use the standard error snackbar without allocating
a built-in tab/session or running integrated shell recovery. Pending state and
duplicate-call exclusion are shared across hooks using the same QueryClient,
plugin, and resource key, including surfaces mounted during a launch. Calls are
blocked synchronously before the pending render. Its exported `NativeExecInput`
and `UseNativeExecResult` types support typed consumers.
The handwritten `ExecClient.OpenNativeSession(plugin, connectionID, options)`
encodes `SessionOptions` safely; do not pass unbounded objects directly to the
generated encoded-string binding.

The host resolves the CLI using its restored login-shell PATH. It writes a
mode-0600 launch script inside a private mode-0700 temporary directory, with
POSIX-quoted executable, arguments, environment additions, and working directory.
The script deletes itself before execution. Failed launches remove the private
directory. The host resolves fixed allowlisted bundle IDs through NSWorkspace
using built-in JXA/AppKit, without Apple Events or a Swift runtime dependency.
Escaped AppleScript addresses that installed application path to create a fresh
window; the host never types into an existing interactive session. Discovery and
Automation calls have deadlines. A successful launch means the terminal accepted the new window,
not that the remote shell connected successfully; remote errors remain visible
in that new terminal.

If the CLI is missing, install it on the login PATH and restart Omniview. If the
application is missing, install it or change Settings > Terminal. If macOS denies
control, enable Omniview under System Settings > Privacy & Security > Automation
for the selected terminal, then retry. For manual checks use disposable local
fixtures, not production connections or credentials.


### 1.4 Creating a New Plugin

```bash
mkdir -p plugins/my-plugin/{pkg,ui/src}

# Create plugin.yaml
cat > plugins/my-plugin/plugin.yaml << 'EOF'
id: my-plugin
name: My Plugin
version: 0.1.0
capabilities:
  - resource
  - ui
EOF

# Create Go entry point
cat > plugins/my-plugin/pkg/main.go << 'EOF'
package main

import (
    "github.com/omniviewdev/plugin-sdk/pkg/sdk"
)

func main() {
    plugin := sdk.NewPlugin(sdk.PluginOpts{
        ID: "my-plugin",
    })

    // Register capabilities here...

    plugin.Serve()
}
EOF

# Create UI entry point
cat > plugins/my-plugin/ui/src/entry.ts << 'EOF'
// Export your plugin's pages, components, and routes
export default {
    routes: [],
    components: {},
};
EOF
```

A plugin that registers routes gets an entry in the header's **New tab** menu (the `+` button left of the search bar, or Cmd/Ctrl+T) and a "New <plugin> tab" entry in the Cmd/Ctrl+K palette. A new tab opens the plugin's `/` route, its home page. A plugin without routes, such as one that only contributes to another plugin's extension points, gets no entry.

### Canonical resource runtime boundary

Import handwritten resource domain types from `@omniviewdev/runtime` and the
typed client from `@omniviewdev/runtime/api`. Generated Wails resource DTOs,
legacy CRUD inputs, resource namespaces, and tuple-based forwarding methods are
not public resource APIs.

Resource identity is a canonical `ResourceReference`: provider, host-admitted
authority, opaque logical type, exact scope entries, native ID, and optional
incarnation. `AccessRoute` is separate access context. Types do not embed served
API versions, and generic host code must not parse provider type strings.
`ResourceType.nativeAuthorityHint` is optional, nonauthoritative metadata for that
specific type. It is not a catalog-wide authority, a sharing grant, or permission
for JavaScript to construct host identity; target resolution remains host-owned.

Call `ResourceClient.ResolveTarget(pluginID, { route, type, scope,
representation })` before acquiring resources. The host resolves authority and
returns a target and request-local `targetId`. Omit representation only to use
the provider's explicit catalog `defaultRepresentation`; neither the host nor
the runtime guesses the first or sole representation. Missing declared query
dimensions resolve to explicit `any` within the admitted route, never a broader
route. Exact reference links use `ResolveReference` with literal scope entries,
native ID, and an optional incarnation instead of constructing host authority.

Only `identityDimensions` belong in an exact address. A `queryDimensions` entry
may instead be selection-only (for example a repository filter). `Get` derives
exact constraints for shared identity/query dimensions and explicit `any` for
query-only dimensions, using the SDK's `ScopeForAddress`. It never parses an ID
to guess a narrower filter. Both actual source support and a fresh trusted-policy
check must cover that entire derived scope; `any` is not permission proof.
Reauthorization preserves the original request ID, principal, session, resource,
and captured source epoch. Restricted query-only support or policy is rejected
before native `Get` or registry publication.

`Enumerate` and `NativeQuery` retain their explicitly requested query scope.
The native adapter establishes query-only filter truth and coverage; matching
an address proves only identity and shared-dimension membership, never complete
query coverage. Best-effort events and registry-derived graph rules carry no
query-only filter provenance: unrestricted `any` needs no extra identity entry,
but an absent constrained dimension cannot establish membership. Such events
remain unmatched and constrained graph bindings are explicitly unsupported.

`Get`, `Enumerate`, and `NativeQuery` take `(pluginID, { targetId, request })`,
where `request` is the corresponding canonical SDK request. `Get` returns
`HostRecord { key, addressKey, targetId, record, route }`. Acquisition pages return
`HostSourcePage { records, sourcePage }`; `sourcePage` carries native cursor,
count, coverage, consistency, and revision metadata, not host query guarantees.
Host row keys are opaque and include target membership and incarnation. Never
derive them from display fields or calculate them in plugin JavaScript.

`useResolvedResourceTarget` exposes target resolution as a query.
`useResource({ pluginID, request })` accepts a host Get request.
`useResources({ pluginID, request, live: true })` acquires exactly one bounded
native page. Callers own continuation cursors. Unobserved pages discard their
rows; only one displayed acquired page stays observed while another cursor is
attempted. `acquired: { request, page }` retains the exact successful request and
its actual cursor after a continuation failure; `resources` exposes the attempted
request's loading/error state separately. Live flags and `membershipStale` follow
the displayed acquired page, including while another attempted page fails.
Consumers that deliberately display the attempted page instead must gate those
acquired readiness flags with `isAcquiredRequestCurrent`; a failed Next attempt
must not borrow the previous page's live membership claim.
`refreshAcquiredPage()` refreshes that actual page, not the failed attempted
cursor. Plugin or target identity changes, including scope/representation, and
an undefined target clear acquired rows synchronously. Target resolution itself
never exposes an old admission as loading/error placeholder data. The hook
uses the actual advisory native update source, registers listeners before
subscribing and starting native work, and owns cancellation and unsubscription.
Live updates patch only exact host keys already observed on the visible page.
Unknown additions/updates never expand membership or replace an incarnation.
They set `membershipStale`, as do deletes that may leave a page gap; the UI must
offer an explicit page refresh. Pending events are coalesced by observed key,
and unseen bodies are not retained. Native `sourcePage` metadata remains
acquisition provenance; modified view count/revision claims are separate.
Buffered updates belong to the connection generation that accepted them.
Retirement discards those updates before they can write list or detail caches,
including when readiness notifications end in the same connected phase.
Its `bestEffort` guarantee and native cache readiness do not promise an atomic
snapshot/update cutover, replay, gap detection, or P05 continuity.
`live: false` is explicitly finite acquisition, not a subscription.

Set `collection: true` for a collection-wide UI. The hook starts at the first
source page and follows all `Enumerate` cursors internally, deduplicating records
by canonical host key. `resources.data` and `acquired.page` publish the merged
view only after every page succeeds; a continuation failure exposes an error,
not a partial collection. Collection queries use a separate cache partition.
Live observations can still update retained rows after a failed refresh, but
the acquisition error remains visible until a native refresh succeeds.
`refreshAcquiredPage()` reacquires the full collection. Live additions and
updates upsert admitted target records, and deletes remove exact canonical keys
without applying bounded-page membership invalidation. Counts remain unknown,
and the collection retains the same best-effort continuity guarantee. Native
work is cancelled and fenced on target changes, unmount, or connection retirement.
Omit `collection` to keep the explicit bounded-page behavior above.
The host's generic resource table opts into collection mode, so its table
pagination operates over the merged collection rather than native source pages.
Source-page cursors and membership disclaimers are not visible controls.

`Mutate` and `Action` consume canonical SDK requests with explicit references and
tagged `Value` inputs. `useResourceMutations` exposes `mutate(request)` without
triggering a Get; action hooks similarly consume canonical requests.
`useStreamAction` keeps native readiness, listener-first attachment, terminal
errors, and owning cancellation. Presentation, schemas, relationships, health,
events, and action discovery use canonical ancillary types. Scope discovery uses
`useScopeValues({ route, dimension })`, not a host namespace assumption.

Connection editing uses explicit host-owned desired profiles, separate from
native discovery snapshots. The negotiated `connectionOverlay` trait installs a
transactional full replacement of `{ upserts, disabledIDs }` in provider memory;
providers never persist that overlay or modify native configuration files.
Save and Import record only the user's explicit profile. Remove stores a
disabled-ID tombstone, and Reset restores native discovery or removes a manual
profile with no native fallback. Never replay a cached discovery list as desired
configuration. Profile mutation success requires `applied: true`. A host commit
durability failure can return `RESET_REQUIRED` after the new source state became
effective; the host publishes a successfully listed source snapshot in that case.
After a durable commit, inventory publication precedes obsolete-credential
cleanup. A cleanup failure returns `RESET_REQUIRED` without hiding the already
effective profile; caller cancellation does not undo that committed publication.
A failed list or rollback does not establish a known new snapshot. Reload before
retrying any `RESET_REQUIRED` mutation. Profile `active` means effective discovery
membership, not an established connection or live resource readiness.

`ResourceClient.SaveConnectionProfile(pluginID, connection, credentials?)` and
`useConnection(...).saveConnectionProfile(connection, credentials?)` accept a
separate write-only `{ username?, token? }` credential DTO. Never put these values
in public connection `data`. The Wails adapter encodes public configuration
through the lossless request-JSON transport; private input remains a separate
argument and never appears in public profiles, status, or inventory responses.

Omitting the DTO or a field preserves stored values only for the same profile ID,
UID, and unchanged canonical public client configuration. An explicit empty
string clears that field; `{ username: '', token: '' }` clears both. An empty DTO
is not a clear request. Endpoint/configuration changes do not inherit secrets
from the previous target. Native source credentials remain source-owned.

The host stores explicitly supplied values in immutable files beneath the
profile's scoped plugin store (`0600` on Unix). The public desired-profile file
contains only an opaque reference. Each private record binds its ID and UID to a
SHA-256 digest of canonical client `Data`, excluding display metadata. Missing or
mismatched bindings fail closed before credentials reach a provider; changing a
public endpoint while retaining its private reference cannot redirect secrets.
Secret-file sync precedes the atomic public pointer switch;
rollback, reload, removal, and orphan collection preserve the
profile/secret pairing, including an explicit empty-private-data clear. Unix
directory metadata is synchronized. Windows does not support syncing read-only
directory handles, and scoped rename has no write-through option; it does not
provide the Unix directory-fsync power-loss guarantee. Normal cleanup still
removes obsolete secret versions. After sudden power loss, a missing or invalid
referenced credential file fails closed: reload and re-enter credentials rather
than falling back to native credentials or another private version.
These files are not encrypted. On Windows, before creating a private file, the
host validates the scoped store directory handle's owner and DACL. Before every
profile read and credential replay, it also validates that directory and the
public profile file handle. Broadly shared custom stores or public files are
rejected, preventing public-configuration tampering and an untrusted inherited
handle surviving file restriction. Trusted inherited directory and public-file
entries are allowed.
The host atomically creates private files with a protected DACL through a native
create relative to the validated directory handle, permitting only the current
user, SYSTEM, and Administrators from creation. No mutable absolute path or
post-creation handle-access upgrade is used. Before reading, it requires an owner
from that same trusted set (including elevated-token Administrators ownership)
and rejects DACL entries granting access to any other principal.
Unix files require mode `0600`. Reported uncertain rollback/durability returns
`RESET_REQUIRED`, not a successful save.

Deploy the SDK private-overlay transport fix in both host and plugin before
using credential saves, then publish the matching runtime before upgrading
plugin dependency pins. Saving applies configuration; a subsequent explicit
Start and Check uses the saved ID. Native `CONNECTED` lifecycle state does not
prove every resource permission or replace an authenticated resource operation.

Effective connection inventory starts empty and is replaced only by successful
fresh source snapshots plus actually applied overlays. Failed discovery never
activates an old cache for Get/List or utility capability lookups. Legacy mixed
cache bytes remain untouched for inactive review/import, including stop/restart;
removed source IDs do not survive by union-merging refresh snapshots.
Load success/failure inventory publication stays inside the serialized
configuration transaction. Native connection-watch frames are notifications:
the host fetches fresh authoritative `ListConnections` facts under that same
fence for cache publication, sync events, and auto-connect scheduling. It never
reapplies an overlay while consuming the stream, and an older queued frame
cannot resurrect a disabled profile or overwrite a newer transaction.
Native catalog binding retirement clears source-bound authorities, resource
observations, graph declarations, and subscriptions, but retains configured
connection metadata. A reconnect must not remove the route from connection
inventory or aggregate readiness. Only authoritative inventory/profile changes
remove configured membership; readiness still comes from the native trait.

`GetAllConnectionStates` exposes `readiness`, not an inferred `started` flag.
The optional `connectionReadiness` trait snapshots only the source's registered
client state: `DISCONNECTED`, `PENDING`, `CONNECTED`, or `FAILED`. It neither
probes the network nor starts a client. `CONNECTED` is registration, not network
health; the host obtains an exact catalog pin before any subsequent watch-state
read and fences both observations against source-generation changes. A stopped
connection needs no catalog, resource Get, or watch. Providers without this
optional trait stay visible as `UNKNOWN` with a safe `readinessError`; timestamps
and watch notifications never turn unknown into connected or disconnected.
Runtime and UI connected counts and sync controls use only explicit `CONNECTED`.
Failed plugin startup closes its dispensed source exactly once even when the
provider was never published; saved desired profiles and the original typed
startup failure survive that teardown.

### Borrowed connection tools

Borrowed MCP tools use the host's sanitized snapshot of configured connections.
Native resource discovery has a separate deadline. Its timeout does not remove
borrowed tool names. The relay still checks live grants, lifecycle cancellation,
connection state, and consent at dispatch.
Consent binds the exact tool contract and target. An unrelated catalog change
does not cancel that consent. A changed or removed tool, policy change, or
session retirement still cancels the call and blocks late results.

### Connection/server metadata

Use the optional resource-v2 `connectionMetadata` trait for public connection facts such as `aws.region` or `kubernetes.server_version`. Keep configuration in desired profiles and resource inventory/capabilities in resource queries/catalogs. Do not store summaries; derive them from selected keys in the consumer.

```tsx
import {
  useConnectionMetadata,
  readCurrentConnectionMetadataString,
} from '@omniviewdev/runtime';

export function ServerVersion({ connectionID }: { connectionID: string }) {
  const metadata = useConnectionMetadata('kubernetes', connectionID);
  const version = readCurrentConnectionMetadataString(
    metadata.snapshot,
    metadata.transportAvailable,
    'kubernetes.server_version',
  );
  return <span>{version ?? 'Version not verified'}</span>;
}
```

Get/subscription reads never connect or acquire facts. Call the hook's `refresh()` action explicitly when a newer observation is needed. Start schedules the provider's initial observation. Unsupported providers differ from supported providers with no observations.

Entries expose `current`, `stale`, or `unavailable` and per-key observation times. Current means generation-valid, not recently checked. A stop retains values as stale; reconnect replaces the generation. Transport loss also makes cached values unsuitable for decisions. Display can show stale values with a warning, but metadata never grants authorization or replaces catalog capabilities.

`useConnectionMetadataSelector(pluginID, connectionID, selector)` supports narrow subscriptions whose selected value remains unchanged when unrelated facts update. `useConnectionMetadataConnections` shares the same store for dynamic connection collections such as folder-rule evaluation; it does not introduce batch acquisition.

Providers configure `Config.ConnectionMetadata` in the SDK and return atomic keyed observations/removals. Use literal dotted keys, stable JSON types, bounded values, and safe errors. Strip credentials and endpoint queries/fragments before publication. Metadata remains in memory, separate from profile persistence.


Use `valueToJSON` only for presentation: signed and unsigned integers within the
JavaScript safe-integer range project exactly to `number`; wider integers remain
`bigint`. This projection does not retain signedness or integral-double intent:
never reconstruct RPC/write bodies from it. Use the original tagged `Value`.
Use `valueToJSONText` and `jsonTextToValue` for JSON editors so large integer
literals never pass through lossy JavaScript numbers. Editor schema
bindings retain shared document references and exact root pointers; acquire a
referenced document through `GetSchemaDocument` rather than copying it per type.

Generic YAML editing preserves canonical scalar intent through native YAML float
nodes and the original scalar AST, including untouched integral doubles, unsigned
integers and negative zero. Resource exec, logs, metrics and port forwarding
receive the observed tagged body, reference and route, not the display projection.
True nonresource utilities omit those canonical fields; cluster metric keys do
not imply a fabricated resource reference or body.
Metric query and stream hooks accept utility `params` separately from the body;
provider configuration belongs there, including connection-specific Prometheus
overrides, rather than in invented fields of a canonical resource body.
Queries remain usable if canonical metric streaming is unsupported. A failed
stream retires its exact subscription interests and releases pending commands;
it does not fall back to the legacy resource-data wire.
Metric streaming opens a lazy lane for each `(pluginID, connectionID)` using its
real host profile through the existing trusted PluginContext metadata seam.
The SDK's sole connection registry admits the actual started client generation
before ready acknowledgement and owns cancellation on stop/retarget; metadata
alone is not a grant and does not auto-start a stopped profile. Host profile
transactions cancel the old lane and block new opens until completion. Ordinary
cluster metrics still omit canonical resource bodies/references/routes.
Reference-bearing utilities use a native, operation-scoped reference-admission
callback bound to the proper caller realm. It validates current catalog,
authority, scope and source epoch without acquiring a resource Get permission or
reading a body. The exact admitted catalog revision travels in unary SDK context
or a host-derived metric subscription frame field; frontend callers cannot
supply that pin. Missing reference admission fails closed before native work.
Each new metric interest receives a fresh internal SDK wire subscription ID,
separate from its public event ID. Output translation requires the current
interest, matching wire ID and exact lane; retired wire IDs never bind to new
interests. Recoverable polling errors keep that ownership so later samples and
explicit native unsubscribe remain useful. Only unsubscribe or lane termination
retires the interest.

Native utility controllers depend only on the `ConnectionReader` lookup contract.
The UI composition supplies its realm-bound resource wrapper for that lookup;
the typed native `Service` is not the encoded Wails transport interface.

Use the handwritten resource, exec, logs, metric and networker clients for
Value-bearing requests. Construct typed object literals using `LogSessionRequest`,
`MetricQueryRequest`, or `PortForwardSessionRequest` (with
`ResourcePortForwardTarget` for a resource connection), exported from
`@omniviewdev/runtime/models` and their corresponding client modules. These
inputs are not generated Wails classes and have no `.createFrom` constructor.
`PluginCapability` names plugin services; `ResourceCapability` describes a
catalog operation and scope. There is no ambiguous public `Capability` alias.
The Wails adapter carries exact canonical JSON as a string so outer `JSON.stringify`
cannot normalize double `-0` to `0`; Go decodes through existing strict SDK DTO
admission, without another semantic Value format. The SDK profile remains 32 MiB
per inner message, 16 MiB per body, depth 64, 262144 nodes and 1048576 fields.
The separate outer Wails request profile is 64 MiB, reserving 64 KiB for routing
arguments and the method/envelope (including 8 KiB for the latter). Escaped
strings count toward the outer ceiling independently; raw generated
Value-bearing request methods are transport internals, not public author APIs.

Observed-row drawers receive their original `HostRecord` and open directly.
Linked-reference drawers perform a fresh canonical Get with the resolved
`targetId`, retain incarnation checks, and cancel superseded navigation.

The host's bottom-drawer provider must enclose the right-drawer provider.
Resource drawers render beside the right-drawer provider's children, so nesting
the bottom-drawer provider inside those children leaves resource actions outside
its context. Log and terminal actions must create visible, focused session tabs,
not merely successful backend sessions.

The resource wire major is 2; unrelated go-plugin services still negotiate their
existing cohort version. The host registers only the canonical resource service.
`Features` negotiates optional ancillary traits before connection or update
startup; a remote client's Go method set is not evidence of provider support.
Finite support remains connection/type/scope-qualified catalog data.

Authority hints are untrusted observations on each catalog type descriptor,
never canonical authority or permission. The host observes the complete admitted
catalog coherently. Equal validated hints can share one connection-local backing
authority within that observation and route; they never merge route aliases.
Absent hints isolate each Type. Joining, leaving, or returning Types preserve a
same-hint authority justified by a surviving current member. A fully retired
cohort receives a fresh authority if it returns; historical cohorts are never
resurrected. Explicit backing-config retargeting invalidates current assignments.
Existing saved citations are never rewritten to a new authority.
No native scheme currently qualifies for stable-native continuity. On the first
fenced catalogue observation after host/plugin generation restart, persisted
unknown/connection-local assignments are retired, including Types absent from
that catalogue. A claimed native hint alone cannot prove cross-restart
continuity. Existing historical facts keep their old authority; live use of a
retired reference returns `RESET_REQUIRED`, never reinterpretation as the new
backing. Unknown incarnation stays absent. Request-local target labels do not
create leases, permissions, or saved resource identity.
Catalog acquisition captures the route's configuration epoch before provider IO.
The host checks that captured epoch under the same fence as authority persistence
and route invalidation. A stale catalog cannot replace a newer durable binding,
even when its caller would later reject the stale result.

Native operations pin the **exact accepted** SDK `Catalog.Revision` through
`WithCatalogRevision`; neither client nor host substitutes a latest-cache token.
The SDK frames the actual source/client binding epoch separately from native
catalogue metadata revision. The host uses `CatalogBindingEpoch`, never token
parsing: metadata/CRD churn preserves existing authorities, while a changed
binding retires the route and fails the current operation with `RESET_REQUIRED`.
Late catalogues cannot flip the source back, and retired binding epochs are not
reused. Custom providers use `NewCatalogBindingEpoch` and `BindCatalogRevision`,
rotating the epoch on actual source/configuration generation changes; fixed
stateless sources issue one per instance. Missing or stale pins fail closed.
Relationship targets on another provider/route require their own exact accepted
catalogue pin, never the source route's token. Current host declaration
extraction binds targets within its observed source route; unobserved routes are
unsupported rather than fabricated.

Host configuration changes block affected routes **before** source mutation and
keep them blocked through durable save and any rollback. Actual endpoint/auth or
source-membership changes retire captured work; display-only renames preserve
authority. Serialized start/stop/profile/host-triggered discovery transactions also retire
the exact native metric lane before mutation and unblock it only after the
transaction, without calling external hooks under the plugin-state lock.
Rollback never restores a retired authority or old source epoch.

Graph queries take `(pluginID, reference, route, ...)`, never namespace/name
tuples. Each returned graph node carries its canonical reference, independent
access route, and host-issued address `key`; clients must not reconstruct keys
from labels, paths, or route IDs. Graph keys identify addresses, while live and
finite row keys also identify acquisition membership and incarnation. Relationship
descriptors belong to the exact plugin, access route, and opaque type. They use
`TargetType`, literal `TargetScope`, and explicit `ScopeExtractors` for native
body fields. No namespace, UID, label, or timestamp
is inferred from Kubernetes-shaped metadata. Advisory `bestEffort` updates keep
the registry and relationship index current even without a frontend subscriber;
subscribed delivery rechecks the original caller's access and target membership.
This observed graph is not a planner, a complete query result, or a P05
continuity guarantee.
Extraction rules carry explicit host-admitted source and target bindings from
one catalog observation, including target identity dimensions and the captured
route configuration epoch. Field-path targets use the target's authority and
declared exact scope mapping; selectors do not assume source/target authorities
are equal. Absent optional links are known absence. A present link with missing
binding, unmapped required dimension, or invalid native ID produces an explicit
whole-result error, never a fabricated reference or silently complete graph.
Rule, selector, and coverage publication uses the same captured-epoch fence as
route invalidation, which retires all three. Identical admitted metadata does not
discard existing derived observations.
Before returning graph data, the host independently admits each cited node's
actual plugin and route and validates its reference against the current target
type's catalog binding. An inaccessible, removed-type, or stale-authority target
fails the entire graph request: nodes are neither silently filtered nor rekeyed
to a new authority, and the root's authority never substitutes for a peer's.

The implementation-candidate `omniview.resource-wire-policy.v1` bounds frames at
32 MiB, resource bodies at 16 MiB, depth at 64, nodes at 262144, fields at 1048576,
and native pages at 256 records. Aggregate pages remain frame-bounded before
generated decoding. These finite transport ceilings require final policy review;
they do not change the separate predicate/projection policy or promise latency.

Source sessions cap retained membership at 128 MiB, the same limit as snapshot
staging. Incremental changes that exceed this limit fail with `RESOURCE_LIMIT`.
Retained members, committing snapshots, and members referenced by in-progress view
snapshots share a 256 MiB ledger. View references can cause a snapshot or change
to fail with `RESOURCE_LIMIT`; the session remains failed until refreshed.

### Protecting connection-dependent routes

Plugin availability is not connection readiness. Wrap the resource subtree in the runtime's `ConnectionBoundary` before rendering components that use resource hooks. Keep connection lists, creation, and credential editing outside the boundary.

```tsx
import { ConnectionBoundary, ConnectionBoundaryFallback, useConnection, usePluginRouter } from '@omniviewdev/runtime';
import { Outlet, useParams } from 'react-router';

function SavedConnectionIdentity({ connectionID }: { connectionID: string }) {
  const { connection } = useConnection({ connectionID });
  return (
    <header>
      <h1>{connection.data?.name || connectionID}</h1>
      {connection.data?.description && <p>{connection.data.description}</p>}
      <code>{connectionID}</code>
    </header>
  );
}

export function ConnectionResourcesRoute() {
  const { connectionID = '' } = useParams();
  const { navigate } = usePluginRouter();
  return (
    <ConnectionBoundary
      connectionID={connectionID}
      fallback={(state) => (
        <ConnectionBoundaryFallback
          state={state}
          connectionDetails={<SavedConnectionIdentity connectionID={connectionID} />}
          onEditConnection={() => navigate(`/connection/${encodeURIComponent(connectionID)}/edit`)}
          onBack={() => navigate('/')}
        />
      )}
    >
      <Outlet />
    </ConnectionBoundary>
  );
}
```

Use this component as the parent of your resource routes. The parameter name and edit destination above are examples; your plugin owns its route layout. `pluginID` resolves from plugin context, or can be supplied explicitly outside it.

The boundary checks readiness without connecting. Only a backend `CONNECTED` result mounts its children. **Connect and continue** explicitly starts the connection and keeps the requested URL. Authentication, permission, missing-connection, and other failures remain blocked with recovery controls. Disconnect and plugin lifecycle events invalidate pending work and remove protected content. A pending connection still permits a manual status check; there is no automatic reconnect loop.

While a stop request is pending, checks, reconnect attempts, and resource admission stay blocked even if the backend still reports connected. Readiness can be checked again after shutdown completes.

There is no connected splash: successful readiness replaces the entire fallback with the requested resources. `ConnectionBoundaryFallback` also renders nothing when given a connected state directly.

Use its `connectionDetails` React-node slot to inject a plugin-owned identity panel above the shared status and recovery actions. The slot replaces the generic name label, not the readiness check. Load saved metadata through `useConnection` without requesting live resources; keep the exact route ID visible if metadata is missing or unavailable. Do not let metadata loading hide recovery controls.

Kubernetes supplies `ClusterConnectionDetails`: saved display name, avatar, provider, description, context, auth-user name, kubeconfig path, and full opaque connection ID. It honors display overrides and renders only allowlisted identity fields, never tokens, passwords, private keys, or raw kubeconfig contents. Other plugins can provide account, project, region, or endpoint details through the same slot without Kubernetes-specific host code.

`useConnectionReadiness({ pluginID, connectionID, enabled })` exposes the same shared state and `connect`/`retry` actions for custom UI. State is keyed by the full plugin and connection IDs; checks and starts are deduplicated. Re-entering a route checks again. Focus checks keep connected content mounted unless verification fails.

Resource queries, graph reads, editor schemas, and scope-value discovery wait for readiness. Their `enabled: false` option suppresses both checks and resource work. Resource subscriptions clean up on disconnect; invalidated in-flight reads cannot publish a late snapshot. Resource mutations check readiness before dispatch. These guards do not undo a mutation already accepted by the backend.

The host also guards resource drawers that supply `ctx.resource.pluginID` and `ctx.resource.connectionID`, including their views and actions. Custom panels outside those surfaces should use the same boundary rather than trusting cached connection metadata.

#### Editor and metadata ownership

| Transition | UI contract |
| --- | --- |
| Plugin or connection identity changes | Start a fresh editor draft and operation state. |
| Metadata refresh overlaps another request | Accept only the current request's response; ignore retired and unmounted completions. |
| An operation completes after its editor retires | Do not update the replacement editor's feedback. Already accepted backend work is not rolled back. |

#### Loaders and imperative calls

React Router may run child loaders before a parent component or parent loader completes. A render boundary alone does not protect loader I/O. Guard each connection-dependent loader or direct native call explicitly:

```ts
import { withConnectionReady } from '@omniviewdev/runtime';
import { ResourceClient } from '@omniviewdev/runtime/api';
import type { HostGetRequest } from '@omniviewdev/runtime';

export function loadResource(
  pluginID: string,
  connectionID: string,
  input: HostGetRequest,
) {
  return withConnectionReady(pluginID, connectionID, () =>
    ResourceClient.Get(pluginID, input),
  );
}
```

`withConnectionReady` checks without starting, retains lifecycle observation through the operation, and rejects a result invalidated by a disconnect or plugin change. Handle its rejected promise in the loader's error/recovery UI. `requireConnectionReady(pluginID, connectionID)` is also available for an admission-only check; it does not fence work performed afterward. Raw `ResourceClient` calls are not automatically intercepted.

Connection readiness is separate from watch synchronization. Do not gate on refresh timestamps, `isStarted`, or `isFullySynced`. A connected target can still have resource-level RBAC or synchronization errors; show those locally rather than reconnecting the entire connection.

For UI development, `ConnectionBoundaryFallback` is presentation-only. Supply mocked `ConnectionReadiness` states and connection identity in Storybook without making connection calls. Kubernetes provides checking, disconnected, connecting, unauthorized, forbidden, missing, error, and metadata-loading/failure examples under **Connections/ConnectionBoundary**. Its interactive recovery preview replaces the splash with a mocked Pod resource table; it does not show a separate connected screen.

Recovery screens use the shared button hierarchy: `variant="solid" color="brand"` for the primary connect action, and `variant="outline" color="neutral"` for retry, edit, and back actions. Reserve `ghost` for contextual tertiary controls, not standalone recovery actions: its transparent surface and muted label can lose affordance against the page background. Reuse theme tokens and component variants instead of adding screen-specific button colors or overriding ghost buttons globally.


### Scoped global search

Register `SearchProviderV1` contributions on `omniview/global-search` through the plugin's existing `extensionRegistrations`. Import the contracts, `resourceQueryKeys`, and `openGlobalSearch` from `@omniviewdev/runtime`. The host alone owns Cmd/Ctrl-K. Sidebar controls call `openGlobalSearch({ scope })`; they do not install another shortcut or overlay.

Kubernetes registers its real provider using the normal extension-point contract:

```ts
{
  extensionPointId: 'omniview/global-search',
  registration: {
    id: 'kubernetes/global-search',
    plugin: 'kubernetes',
    label: 'Kubernetes',
    value: kubernetesSearchProvider,
  },
}
```

#### Default connection context

Declare `SearchRouteHandleV1.searchScope` on a plugin's connection route `handle`. This is ordinary route metadata, not another registry or a provider-specific host URL parser.

```ts
import type { SearchRouteHandleV1 } from '@omniviewdev/runtime';

export const connectionSearchHandle: SearchRouteHandleV1 = {
  searchScope: ({ pluginId, params }) => params.connectionId ? {
    kind: 'connection',
    pluginId,
    connectionId: params.connectionId,
    label: params.connectionId,
  } : undefined,
};
```

Attach this handle to the connection parent route. Parameter names belong to the plugin; `connectionId` above is an example, not a host convention. Callbacks receive frozen parameters decoded exactly once, the owning plugin ID, the raw plugin-relative pathname, and the query string. Keep resolution synchronous and free of native calls.

Header search, Cmd/Ctrl-K, and `openGlobalSearch()` seed only a connection scope. Resource pages inherit that connection; they do not automatically add resource-type or object chips. The nearest valid owner-matching connection handle wins. Undefined, invalid, foreign, or throwing children inherit an ancestor; a null handle explicitly opts out.

An explicit `openGlobalSearch({ scope })` still supports deeper scopes. `openGlobalSearch({ scope: null })` forces an unscoped search. Removing chips stays unscoped for that session; a later open resolves the current route again. Global search and the resource table's own find field remain separate controls.

#### Provider lifecycle and execution

| Member | Contract |
| --- | --- |
| `supportsScope(scopes)` | Pure synchronous routing before bounded scheduling. Return false at unsupported depths. The host routes owner scopes before applying its source cap; unrelated plugins cannot starve the scoped owner. |
| `connectionTarget(connectionID)` | Optional validated connection destination. Without it, Enter opens the plugin root. This callback does not transfer connection recovery ownership. Adapter failures remain isolated to that adapter. |
| `connectionRecovery` | Defaults to `host`. Set `provider` only when the provider supplies recovery throughout its supported scope depths. |
| `search(request)` | Receives immutable scopes, literal query text, limit, generation, and abort signal. Discovery must not connect or mutate resources. Return bounded items and honest `complete`/`truncated` completion and typed availability. |
| `validateAction(action, context)` | Optional availability gate against the current registered action inventory. Avoid repeating the authoritative object read in both this gate and execution. |
| `executeAction(action, context)` | Required for action rows. Revalidate the native target and permissions at dispatch. Await actual session/action setup; do not report success before a rejected promise settles. |
| `validateResource(target, data)` | Optional provider-owned validation after the host's canonical Get. Canonical incarnation checks do not depend on this callback. The host does not inspect Kubernetes metadata or invent another plugin's object schema. |
| `Context` | Optional headless action/dialog root with the owner's real plugin context. Memo, forwardRef, and lazy components are accepted. Contexts share metadata/settings loading per plugin and survive palette closure. Replacement/unregister ends their lifetime. A failed context disables only its source; other plugins remain usable. |

Results contain serializable intents, not executable callbacks. Action IDs must have the owning plugin's `pluginId:` prefix. Only responses from the current owning provider may contain executable action references; static action registrations and action rows without an executor are rejected.

Execution context supplies fenced `openResource` and validated `navigate` helpers. Set `action.recovery: 'connection'` only for recovery targeting the same connection ancestor. Return `{ keepOpen: true }` after successful recovery to preserve the query and all resource scopes. Searching never automatically connects, refreshes credentials, or treats forbidden access as a reconnect workaround.

Use existing action inventories and confirmation/parameter components. Keep them in `Context`, not a hidden resource table or a second palette. The host's activation check is not an atomic transaction: plugin backends must enforce permissions and any native mutation preconditions. Closing search fences obsolete feedback; it does not roll back an accepted mutation.

#### Native identity, not Kubernetes-shaped data

Resource-type scopes contain `{kind:'resource-type',pluginId,target:ReadTarget,targetId,label,scopeLabel?}`. Resource scopes contain `{kind:'resource',pluginId,reference:ResourceReference,route:AccessRoute,representation,targetId,label,scopeLabel?}`. Connection scopes retain `connectionId`. Resource identity includes provider, host authority, native type, exact scope dimensions, opaque ID, and optional incarnation; the access route stays separate. Labels are presentation only. `targetId` is a bounded request-local context label, not a persistent key or authorization grant. The host validates every actual request independently.

Obtain references and targets from host resolution or observed host envelopes. Keep native IDs opaque and encode region, account, project, namespace, engine, or node as their declared scope dimensions. Never mint canonical keys, infer authority, fabricate namespaces, or concatenate lookup tuples in the browser. Direct resource scope overrides add only a connection ancestor; they do not invent a broader resource-type target. Set a result's `scope` for Tab/pointer exploration; Enter executes its intent.

Canonical Get requests carry the full reference, separate route, and representation. A provider must reject unavailable or ambiguous references rather than fall back to a same-name object. Provider-owned navigation/actions remain available, but cannot bypass host authority validation or native preconditions.

Sidebar and drawer maps use provider-defined, nonempty resource type IDs. The host does not require or parse a `GROUP::VERSION::KIND` grammar. For example, `k8s:/pods` and `k8s:core/pods` remain distinct keys; their labels or API-version metadata do not make them interchangeable.

#### Shared resource icon sets

Register `ResourceIconSetV1` at `RESOURCE_ICON_EXTENSION_POINT_ID` (`omniview/resource/icons`) using the same `extensionRegistrations` mechanism. Its value contains `schemaVersion: 1` and `resolve(resourceKey)`, returning a React component accepting `ResourceIconProps`, or undefined for an unknown key.

Render `ResourceIcon` with `pluginId`, `resourceKey`, optional `size`, and optional `fallback`. The host keeps keys opaque and consults only sets owned by that plugin. Reuse this component in the plugin sidebar; search uses the same set for resource rows and scope chips. Missing sets, unknown keys, resolver/render errors, and lazy loading use a local fallback without replacing the surrounding search UI. Replacement and unload update mounted consumers.

Custom renderers can use `useExtensionPointSnapshot<T>(id)` for an immutable `{ store, version, contributions }` snapshot. Its contribution array changes when registrations change, including extension-point replacement. Use this render input rather than memoizing `store.listAll()` from a stable mutable store reference; React Compiler can otherwise retain stale contributions. `useExtensionPoint` remains available for imperative store matching and registration.

Resource glyphs should inherit `currentColor` and match adjacent monochrome controls; connection branding is separate. Kubernetes adapts the upstream glyphs into trusted, sanitized inline SVG without blue badge backgrounds. Attribution and modification notes are bundled with the artwork. Do not inline runtime-provided SVG text. For file-based icons, resolve imported URLs against the plugin's `import.meta.url`; a root-relative plugin development URL must not resolve against the host origin.

The reference set is `kubernetes/ui/src/icons/resourceIcons.tsx`. Other plugins can supply their own SVG components or icon libraries without adding those libraries to the host.

#### Live data, cache ownership, and failures

The host shares source sessions across resource views and releases them when their interests close. A view receives a snapshot and status, followed by updates when supported. Failed sources retain existing results and expose a retry.

Use the public cache keys when storing native snapshots:

- `resourceQueryKeys.all(pluginId)` is the resourcev2 invalidation prefix.
- `resourceQueryKeys.scope(pluginId,target:ReadTarget)` partitions a canonical read target.
- `resourceQueryKeys.list(pluginId,{targetId,request:EnumerateRequest})` stores `HostSourcePage`, with host-keyed records and separate native source-page metadata.
- `resourceQueryKeys.resource(pluginId,{targetId,request:GetRequest})` stores `HostRecord`, never a display projection or legacy GetResult.
- Pagination, representation, query scope, and native query inputs remain explicit request fields; never replace an unfiltered acquisition page with search-filtered rows.

Use `openSourceView(pluginId, {targetId, target, updates})` for a source view. The runtime attaches to the view topic before synchronization, stages snapshot chunks until `snapshotEnd`, and applies ordered changes by host record key. Close the view when it is no longer needed. A reset starts a new view generation; continuity and coverage describe the source's guarantees.

The PR workflow runs `src/resource/v2/sourceView.test.ts` from `packages/omniviewdev-runtime`.
The suite checks atomic snapshots, frame-batched notifications, continuity gaps, and view retirement.

Use the cache query's signal for shared native work and the request signal to fence obsolete search publication. Cancelling a search must not cancel another table's shared fetch. Resource/action execution still performs its own fresh identity and authorization checks instead of trusting discovery cache freshness.

Distinguish disconnected, connecting, authentication-required, forbidden, unavailable, and partial states. Return safe actionable messages, not raw credentials or backend internals. Treat a deleted/replaced object as an object failure, not a reason to reconnect. Plugin registration, replacement, unload, and authoritative connection removal update the current search and fence retired results.

Query edits retain the previous result surface, disable obsolete activation, and publish the replacement query wave coherently after its sources settle. CommandList does not apply another label-only filter to provider-ranked results. Compact icon/status badges carry availability; full source messages remain under Details. Providers must still report truthful typed states and bounded completion.

Kubernetes is the reference integration in `ui/src/search/provider.tsx`. It caches resource snapshots for 15 seconds and readiness for 2 seconds, scans at most 200 objects, reports incomplete results, and transfers exact list text without changing structured filters. See [scoped search design and acceptance cases](scoped-search-design.md).

### Inspecting extension registrations

Open **Developer: Inspect Extensions** from global search, or choose
**Inspect contributions** in plugin details. Diagnostics live in a workspace
tab, not a Settings category.

The namespace tree groups extension points and their contributions. Use the
plugin filter to inspect one contributor without losing the point hierarchy.
The contribution table includes every registered value, including entries
hidden by single-mode selection or quarantine. Pending registrations appear
separately because their requested target point does not yet exist.

Select a Problem to reveal the associated contribution and captured evidence.
The inspector distinguishes module loading, registration, context resolution,
and quarantine. None of these proves a component rendered successfully.
Captured crash history is bounded session evidence and can clear on reload or
re-enable. Export before recovery; inspect potentially sensitive errors locally
before sharing them.

The full-height explorer sits beside the registration editor and metadata
inspector. Problems dock below the editor and inspector; all three pane
boundaries can be resized. Repeated problems group by kind, plugin, point,
contribution, and boundary. Expand a group or the inspector's event history to
review every retained record; exports retain the ungrouped bounded evidence.
Registration JSON contains only the safe type descriptor, never contribution
values. Lifecycle and render eligibility remain explicitly unknown where no
instrumentation exists. Coverage and safety details are available in a disclosure.
Double-click a resize handle to restore its default size. Narrow windows clamp
the side panes without clearing the selected registration or filter. If a registry
change invalidates an action's capture, select the current registration again
before running lookup or recovery.
Initial selections bind to the first capture with a resolved runtime window
identity. Later inventory updates do not silently replace an action's capture.

Reveal sensitive exception text captures and pauses the current state. Resume
before lookup, recovery, or another reveal. Safe JSON export still redacts text
from a sensitive paused capture. Sensitive export and recovery require review
or confirmation; recovery clears the contribution's captured crash history.

Context lookup is an explicit action because plugin matchers can execute code.
It never mounts contributed components. Unsupported context types and gaps in
specialized-consumer diagnostics are labeled instead of treated as healthy.

Agents can inspect the same live document without using the UI:

```sh
omniview-dev extensions inspect --workspace /path/to/workspace \
  --plugin my-plugin --json
```

See [extension diagnostics for agents](development-cli.md#extension-diagnostics-for-agents)
for point/issue filters, explicit resource-context lookup, window selection,
and sensitive-error opt-in. A missing frontend is an unavailable capture,
not evidence that the plugin registered nothing.

### 1.5 Contributing a Theme

UI plugins can contribute themes through the `omniview/theme` extension point. A contribution contains the theme definition without an `id`; the host derives the globally unique ID from the plugin and registration IDs.

```ts
import type { ThemeDefinitionV1 } from '@omniviewdev/base-ui';
import type { ExtensionRegistration } from '@omniviewdev/runtime';

type ThemeContribution = Omit<ThemeDefinitionV1, 'id'>;

export const extensionRegistrations = [
  {
    extensionPointId: 'omniview/theme',
    registration: {
      id: 'slate',
      label: 'Slate',
      value: {
        schemaVersion: 1,
        name: 'Slate',
        base: 'void',
        author: 'Acme',
        version: '1.0.0',
        tokens: {
          'color.bg.base': '#101114',
          'color.bg.surface': '#16181d',
          'color.accent.strong': '#82a8ff',
        },
      },
    },
  },
] satisfies ExtensionRegistration<ThemeContribution>[];
```

For a plugin whose ID is `acme-tools`, the registration above has the canonical theme ID `plugin:acme-tools/slate`. More generally, the host derives `plugin:<encoded-plugin-id>/<encoded-registration-id>`, URL-encoding both ID components. Plugins should use a stable local registration ID and must not put an `id` inside `value`.

The host validates the schema version, metadata, base theme, token names and values, ownership, and ID uniqueness before adding a contributed theme. An invalid contribution is reported in the developer console and is not registered; it does not prevent other valid contributions from loading.

Registration cleanup follows the plugin lifecycle:

- Unloading a plugin automatically removes its contributed themes.
- If the removed theme is selected, Omniview immediately renders the built-in `void` fallback. The requested canonical ID remains selected, so reloading the same valid contribution makes it active again.
- Reloading or replacing a registration disposes its previous theme before registering the current contribution. Plugin code does not need to unregister themes manually.

Before React starts, the loading surface uses the last cached built-in theme, including validated legacy Light and Solarized preferences during upgrades. Custom/plugin themes use Void for this first paint until their contribution loads; the persisted requested theme ID is not changed. The Appearance theme picker applies selections immediately and exposes the accessible name “Theme.”

### 1.6 Persistent Plugin Data

Use `usePluginData` for profile-backed plugin preferences. Pass a literal value to replace a key, or a pure functional updater to merge with its latest persisted value.

Functional updates use a fresh backend snapshot and compare-and-swap, including across independent windows and QueryClients. A conflicting write re-evaluates the updater, up to eight attempts. Prepare IDs, timestamps, uploads, and other side effects outside the updater. Exhausted conflicts and storage failures reject the update promise; callers must surface the error rather than reporting success.

Literal replacements intentionally remain last-write-wins and do not require reading the old value. They can therefore reset a key whose persisted JSON cannot be read. Failed optimistic writes restore the previous cached value, or the supplied default when no cached value exists.

The host data service exposes `GetSnapshot` and `CompareAndSwap` for this protocol. Revisions are opaque content tokens, not monotonic counters. An absent key has an empty revision; stored JSON `null` has a nonempty revision. Keep both methods and the consuming runtime in the same published host/runtime cohort; older hosts do not provide these bindings.

---

## 2. IDE-Managed Mode (Recommended)

The named workspace host owns plugin builds, Vite, RPC and controller lifecycles. Start from the [workspace CLI workflow](development-workspaces.md); plugin cards and the CLI use the same canonical managers.

### 2.1 Setup

1. Select the plugin repository in a named feature workspace.
2. Start that workspace with `omniview-dev workspace up`.
3. For interactive management, open **Settings > Plugins** in that named instance.
4. Any selected source directory must match the workspace manifest.

The host will:
- Build with the selected verified SDK
- Install transactionally into the resolved workspace state root, never an inferred `~/.omniview` path
- Start a Vite dev server for HMR
- Start a Go file watcher for auto-rebuilds
- Display status indicators in the footer

#### A local plugin is rejected before building

A named workspace accepts only plugin repositories selected in its manifest. The
file picker does not add repositories or change workspace ownership. Selecting a
checkout outside that workspace is rejected even if it builds successfully on its
own. Check the instance's repository and plugin selections before changing tool
paths.

Use the notification's **Details** action for the rejected source and underlying
reason. The footer notification bell retains errors for the current session;
**Copy details** copies diagnostics explicitly. Build output may contain local
paths or secrets, so review it before sharing.

If the collection already registers the plugin repository, stop the workspace,
select the repository and plugin with `workspace edit`, then restart and select
the resulting workspace checkout. Repository mappings are fixed at collection
initialization: if the source is not registered, initialize a separate collection
with that source through the [workspace CLI workflow](development-workspaces.md).
Do not bypass source admission or copy a binary into another profile. A separate
collection and workspace avoid interrupting an instance already in use.

### 2.2 Development Workflow

Once your plugin is installed in dev mode:

**UI Changes (instant feedback)**:
1. Edit any `.tsx`, `.ts`, or `.css` file in your plugin's `ui/src/` directory
2. The Vite HMR system updates the component in-place
3. React state is preserved -- no page refresh
4. Update appears in <100ms

**Go Changes (automatic rebuild)**:
1. Edit any `.go` file in your plugin's `pkg/` directory
2. The file watcher detects the change (500ms debounce)
3. The Go binary is rebuilt automatically
4. The plugin process is restarted with the new binary
5. gRPC connections are re-established
6. The plugin UI re-mounts with fresh backend data
7. Total time: 2-5 seconds

### 2.3 Monitoring Dev Server Status

**Footer indicators**: Colored dots in the bottom-left footer show each dev server's status:
- Green: Ready (Vite running, Go compiled, gRPC connected)
- Amber: Building (Go compiling or Vite starting)
- Red: Error (build failure or connection issue)

**Build output tab**: Click any footer dot to open the build output tab in the bottom drawer. Shows color-coded output from Vite and Go compiler.

**Plugin card**: The plugin card in Settings > Plugins shows detailed dev server info: source path, Vite port, gRPC status, last build time.

### 2.4 Handling Build Errors

When a Go build fails:
1. An error overlay appears on your plugin's UI area
2. The error shows file, line, column, and message
3. The old binary continues running (your plugin is still functional)
4. Fix the error and save -- the watcher auto-rebuilds
5. The overlay dismisses when the build succeeds

When a UI error occurs:
1. Vite shows an error overlay in the browser
2. Fix the error -- HMR updates automatically
3. If Vite cannot recover, refresh the page

---

## 3. Workspace-Managed Development

For isolated feature work, use a named development instance and its authenticated
CLI. The host owns the plugin build, Vite server, RPC connection, controller
initialization and source watcher. A listening port or live PID is not readiness.

```bash
omniview-dev instance inspect --workspace /path/to/workspaces/my-feature
omniview-dev plugin dev link --path /path/to/workspaces/my-feature/my-plugin \
  --workspace /path/to/workspaces/my-feature --wait
omniview-dev plugin dev status my-plugin --workspace /path/to/workspaces/my-feature
```

The instance must already be running with the development control build enabled.
Workspace lookup never falls back to the production profile. Source linking is a
host transaction; do not copy binaries or metadata into `~/.omniview`.

External binary/Air/Delve supervision is not an attachment mechanism. The former
PID-file discovery path did not establish a working RPC attachment and has been
removed. Do not start a second Go or Vite supervisor for a managed plugin.

See [development CLI](development-cli.md) and
[managed lifecycle](development-plugin-lifecycle.md) for generation-aware status,
readiness and dependency-watch details.

## 4. CLI Development Workflow

The host-module `omniview-dev` command replaces the independent plugin runner.
Its commands call the running host's canonical managers; there is no second
plugin process manager in the CLI.

```bash
# List installed plugins, not marketplace publisher listings.
omniview-dev plugin list --workspace /path/to/workspaces/my-feature
omniview-dev plugin dev start my-plugin --workspace /path/to/workspaces/my-feature --wait
omniview-dev plugin dev logs my-plugin --workspace /path/to/workspaces/my-feature --limit 100
omniview-dev plugin dev stop my-plugin --workspace /path/to/workspaces/my-feature --wait
```

JSON results and operation IDs go to stdout. Default log messages are redacted.
Use `plugin dev logs <id> --unsafe-output` deliberately for real bounded log text
in JSON stdout; a stderr warning explains that arbitrary plugin/build output may
contain secrets. Do not automatically forward raw logs to shared reports.
Accepted mutations continue after a client wait timeout; poll their operation ID
instead of submitting the mutation again. Go-only and UI-only capability handling
belongs to the host lifecycle, not a client `--no-vite` switch.

See [development CLI](development-cli.md) for installation, settings JSON input,
all commands and stable exit codes.

## 5. Troubleshooting

### 5.1 "Multiple React instances detected"

**Cause**: Your plugin is bundling its own copy of React instead of using the host's.

**Fix**: Ensure the `external` array in your `vite.config.ts` includes `"react"`, `"react/jsx-runtime"`, and `"react-dom"`. Verify that `@omniviewdev/vite-plugin` is in your devDependencies and `omniviewExternals(external)` is in the plugins array.

### 5.2 Vite HMR Not Working

**Symptoms**: UI changes require a page refresh.

**Checks**:
1. Is Vite actually running? Check the footer indicators.
2. Open browser DevTools > Network tab > WS filter. You should see a WebSocket connection to `127.0.0.1:<port>`.
3. Check the console for HMR-related errors.
4. Ensure your `vite.config.ts` has `hmr.host: '127.0.0.1'` and no hardcoded `hmr.port`.

### 5.3 Managed Port Already in Use

**Cause**: Another Vite instance or process is using the port.

**Fix**: Inspect the selected workspace's actual endpoints and port policy. Sticky allocation may choose another port only through its owned bounded bind-retry path; explicit/strict overrides fail rather than silently increment. Choose another explicit assignment or clear the override with `--port "plugin-vite:<id>=0"`. Never kill a process merely because it occupies a port. Managed Vite uses `strictPort: true`; HTTP and HMR must agree with its actual lease.

### 5.4 Go Build Fails but No Error Shown

**Check**:
1. Open the build output tab (click the footer indicator or go to Settings > Plugins > plugin card > Logs)
2. Check that `go` is in your PATH or configured in Omniview Settings > Developer > Go Path
3. Run the build manually: `cd plugins/my-plugin && go build ./pkg`

### 5.5 Plugin Loads but Connections Fail

**Cause**: The gRPC connection was re-established but controllers were not re-initialized properly.

**Fix**:
1. Try reloading the plugin: Settings > Plugins > plugin card > Reload button
2. Check the plugin's stderr output in the build output tab for errors
3. For workspace-managed plugins, inspect generation-aware `plugin dev status` and bounded `plugin dev logs`; a handshake line alone is not proof of initialized controllers.

### 5.6 Workspace Instance Not Found

Select the workspace manifest/directory explicitly, or use a registered name with
`--root`. The selected development host must be running with control support.
`instance inspect` authenticates and compares the actual endpoint descriptor,
workspace UUID, profile root and generation before any plugin mutation.

### 5.7 Managed Plugin Keeps Disconnecting

Use `plugin dev status <id>` and `plugin dev logs <id>` against the same workspace.
Inspect build, Vite, RPC and controller readiness separately. Repair the source
error and allow the retained host watcher to rebuild, or submit a generation-aware
rebuild. Do not launch an external binary as a fallback.

### 5.8 "Plugin Binary Not Found" After Build

**Cause**: The build output path does not match what the IDE expects.

**Fix**: The built binary must be at `build/bin/plugin` relative to the plugin directory. Check your Go build command outputs to the correct path.

### 5.9 Shared Dependencies Not Resolving

**Symptoms**: `import { useState } from 'react'` fails in dev mode or returns a different React instance.

**Checks**:
1. Ensure `@omniviewdev/vite-plugin` is installed: `pnpm list @omniviewdev/vite-plugin`
2. Check that `omniviewExternals(external)` is in your Vite plugins array
3. Verify the shared deps bridge is initialized (check for `window.__OMNIVIEW_SHARED__` in browser console)
4. If you import a subpath of a shared package (for example `@omniviewdev/runtime/api`), ensure that exact subpath is in your `external` array (exact match, not prefix)
5. The host no longer shares MUI, Emotion or the legacy `@omniviewdev/ui` design system. Build plugin UI with `@omniviewdev/base-ui` (plus `@omniviewdev/ai-ui` and `@omniviewdev/editors`); a plugin that still imports MUI or `@omniviewdev/ui` fails to load

The host shares base-ui 0.10 with plugins and keeps the runtime's development and peer ranges aligned with it. `TreeList.onAction` requires this shared component release; updating only a plugin's npm dependency does not replace the host's `window.__OMNIVIEW_SHARED__` singleton. Upgrade the host before installing a plugin that relies on the new tree activation contract. Keep registry peer checks enabled so an older runtime cannot silently retain the previous base-ui range.

### 5.10 CSS Not Updating with HMR

**Check**: Vite HMR for CSS works differently than for components. If CSS changes are not applying:
1. Check that `cssCodeSplit: false` is in your build config
2. Ensure you are importing CSS files, not inlining styles
3. Try a page refresh as a workaround -- CSS HMR can be finicky with certain PostCSS setups

---

## 6. Configuration Reference

### 6.1 Vite Config Options

| Option | Required | Default | Description |
|--------|----------|---------|-------------|
| `plugins: [omniviewExternals(external)]` | Yes | - | Resolves shared deps from host in dev mode |
| `server.host` | Yes | `'127.0.0.1'` | Must be `127.0.0.1` for Wails webview |
| `server.port` | Managed assignment | Actual workspace lease | Do not hardcode or silently increment managed ports |
| `server.cors` | Yes | `true` | Required for cross-origin module loading |
| `server.strictPort` | Yes in managed mode | `true` | Occupied explicit assignments fail without adopting or killing another listener |
| `hmr.protocol` | No | `'ws'` | WebSocket protocol |
| `hmr.host` | Yes | `'127.0.0.1'` | Must match server.host |
| `build.rollupOptions.format` | Yes | `'system'` | SystemJS format for production builds |
| `build.rollupOptions.external` | Yes | `external` | Same array used by omniviewExternals |

### 6.2 Workspace Environment

`OMNIVIEW_WORKSPACE_FILE` may select an absolute workspace manifest. An explicit
`--workspace` must agree with it. The host provides isolated runtime paths and
assigned service ports to managed children; users should not hardcode discovery
files or force production state roots.

### 6.3 IDE Settings

Available in Settings > Developer:

| Setting | Key | Description |
|---------|-----|-------------|
| Go Path | `developer.gopath` | Path to `go` binary (auto-detected) |
| pnpm Path | `developer.pnpmpath` | Path to `pnpm` binary (auto-detected) |
| Node Path | `developer.nodepath` | Path to `node` binary (auto-detected) |

### 6.4 Instance and Operation Discovery

Use `omniview-dev instance inspect --workspace <path>` for the actual descriptor
and `operation get <operation-id>` for accepted work. Credentials live only in
private per-generation token files and are never included in command output.
Plugin state includes its own generation; pass that generation to `plugin dev rebuild`.

### 6.5 Wails Events (for Advanced Integration)

| Event | Direction | Payload |
|-------|-----------|---------|
| `plugin/devserver/status` | Go -> Frontend | `DevServerState` JSON |
| `plugin/devserver/log` | Go -> Frontend | `DevBuildLine` JSON |
| `plugin/devserver/error` | Go -> Frontend | `{ pluginId, errors[] }` JSON |
| `plugin/dev_reload_start` | Go -> Frontend | Plugin metadata (backward compat) |
| `plugin/dev_reload_complete` | Go -> Frontend | Plugin metadata (backward compat) |
| `plugin/dev_reload_error` | Go -> Frontend | Plugin metadata + error string |

### 6.6 Plugin SDK Functions

```go
// In your plugin's main.go:

// Create a new plugin
plugin := sdk.NewPlugin(sdk.PluginOpts{
    ID:    "my-plugin",
    Debug: true,
    Settings: []settings.Setting{
        // Your plugin's settings...
    },
})

// Register capabilities
sdk.RegisterResourcePlugin(plugin, sdk.ResourcePluginOpts{
    // Your resource plugin configuration...
})

// Serve under the host-managed lifecycle and its isolated environment.
plugin.Serve()
```

---

## 7. Development Workflow Comparison

| Feature | IDE-managed UI | Workspace CLI |
|---------|----------------|---------------|
| Supervisor | Canonical host manager | Same canonical host manager |
| UI HMR and Go rebuild | Host-owned | Host-owned |
| Target selection | Current application | Explicit/enclosing development workspace |
| Multi-plugin addressing | Plugin cards | Explicit plugin IDs |
| Completion | UI lifecycle state | Operation ID, wait, generation-aware status |
| Standalone external attachment | Not supported | Not supported |

Use the CLI for reproducible noninteractive work in isolated development profiles;
use plugin cards for interactive work. Neither path trusts PID-only discovery.


## 8. Log Session Lifecycle

Use the runtime `LogsClient.CreateSession` adapter when opening log sessions.
It reserves a UUID and subscribes before the create RPC, so immediate lines,
errors, and completion events survive until the log viewer attaches. The host
rejects duplicate correlation IDs; these IDs do not grant resource authority.
The handoff retains the newest 10,000 lines within an 8 MiB UTF-8 JSON budget,
100 source events, and the latest session-scoped lifecycle event of each type.
Its 60-second abandonment timeout starts only after successful creation, so a
slow create does not lose early output. Host creation has a 90-second deadline;
the runtime bounds a stalled call to 120 seconds, leaving time for host cleanup.
Accepted streams retain their independent lifetime. Failed or canceled creation
releases listeners immediately.

`SESSION_READY` means source setup completed, not that a line has arrived.
A ready stream can remain empty while following. Finite empty streams complete
normally; they are not lost connections. Source-scoped errors, removal, and EOF
must not terminate other sources. Only session-scoped `STREAM_ENDED` ends the
whole viewer. Each viewer removes only its own event listeners on disconnect.

## 9. Editor schema demand

Resource navigation must not acquire or register editor-only schemas. Mount the
host-owned `window.__omniviewEditorSchemaBoundary` React lifecycle slot around a
schema-aware Monaco surface, passing `pluginID`, `connectionID`, and `children`.
For a typed resource model, pass `resourceType` and its schema-bound `modelPath`
so unavailable schemas for one model cannot borrow another model's status.
Check for the slot before using it: older hosts must show an explicit
compatibility warning rather than claiming schema support.
The slot ships with the host application and requires no new runtime package
export; adopt it only with the corresponding compatible host release or source.

The boundary uses the same `useSchemaRegistration` owner as host editors.
Equivalent concurrent consumers share registration, and the final close removes
it. A newer schema result replaces the current registration; closing an older
consumer never restores a retired result. Runtime schema queries retain their
connection-generation and rendered-document identity guards. Enable model-path
queries only while the owning editor is open.

Children mount after the registry's asynchronous Monaco schema update completes.
Loading, request/update failures, and absent schemas remain distinct. Failure
keeps the editor usable without schema completion/validation and offers an
explicit retry. This lifecycle slot does not change SDK-v2 schema bindings,
availability states, or catalog acquisition.
