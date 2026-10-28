# Scoped command search — design and implementation

Status: design approved; production implementation uses the shared runtime V1 contracts below. Verification evidence is recorded separately from the mock.

## Workspace and preview

Active managed collection: `workspaces/scoped-search-design`, feature `scoped-search-reviewed`, UUID `084c795e-273e-441b-b7c3-deafd689e315`. Browser endpoint: `http://127.0.0.1:23887/`.
Selected source repositories: host, plugin SDK v0.7.0, and Kubernetes. The managed runtime uses the compatible published base-ui 0.7.0 cohort. The `scoped-search` approval and `scoped-search-implementation` verification workspaces remain preserved and stopped. Source-only migration avoided adopting generated dependency trees rejected by the ownership guard.

The standalone synthetic-data mock supported design approval and remains in the preserved design workspace. It is not shipped with the production implementation; the actual shared palette is the interactive reference.

## Business requirements

1. One host-owned Cmd/Ctrl-K overlay in every route. Plugin controls open that overlay with explicit context; plugins do not own another global shortcut.
2. Header, Cmd/Ctrl-K, and `openGlobalSearch()` seed a new search session only with the active connection from the registered plugin route's `SearchRouteHandleV1.searchScope`. Automatic defaults never add resource-type or resource chips, regardless of provider or current page. Explicit scope overrides context and may include deeper scopes; `scope: null` forces global search. The deepest valid owner-matching connection handle wins; undefined, deeper scopes, invalid values, and exceptions inherit ancestors, while null opts out. Callback context and params are frozen and provider-neutral. Unavailable or unregistered plugins provide no default. Removing chips stays global until reopening; navigation never reapplies scope to an open session.
3. Rank relevant matching connections first and activate the best eligible row. Tab on a scopeable row adds a chip, clears the input, and reveals relevant children.
4. Support connection → resource type → resource → registered actions. Namespace remains explicit resource identity; show it on every object result. Namespace scoping may be added as a typed facet, never inferred from a name.
5. Enter opens the selected connection, list, or resource using existing navigation/drawer behavior. Tab explores without opening. Rows expose a compact arrow-only exploration button; the footer explains Tab when applicable. Scope removal lives inside each chip, with separate accessible selection and dismissal controls.
6. A resource-type search offers an explicit “Open list matching …” result. Preserve exact connection, resource type, namespace selection, and filter semantics in the destination.
7. Empty-input Backspace selects the final chip; a second Backspace removes it. Left/right select chips. Removing an ancestor removes descendants. Restore parent query and selection when returning to a parent scope.
8. Escape closes. Shift-Tab traverses controls. Tab only scopes when the input owns focus and the active row supports scoping; otherwise normal trapped focus navigation applies. Ignore composition keystrokes.
9. Color supplements icon, label, and accessible scope description. No color-only connection state. Small screens wrap chips without hiding the query or controls.
10. Show loading, disconnected, authentication-required, permission-denied, empty, partial, truncated, and unavailable states distinctly. Preserve editable scope/query during errors.
11. Never silently connect, reauthenticate, or retry a mutation. Recovery is explicit. Successful connect must reflect returned readiness, not just a resolved promise.
12. Live connection/resource events update rows. Keep active selection by stable identity. Never activate a different object because a row moved or disappeared.
13. Search, sidebar controls, resource menus, and detail drawers reference the same action descriptors and dispatch path. No duplicate Kubernetes action inventory.
14. Dangerous actions require existing confirmation and parameter collection. Logs require container choice when ambiguous. Authorization remains enforced at execution, not by disabled UI.
15. Existing navigation, settings, partial-source isolation, bounded work, stale-result fencing, and extension cleanup remain supported.

## Proposed shared contract

Publish versioned types from runtime; keep validation, admission, ranking, and dispatch host-owned. Migrate every internal caller together rather than maintaining parallel search registries.

- `SearchScope`: discriminated connection, resource-type, and resource identities. Include plugin ID and connection ID; resource identity includes the exact native type key, actual namespace, opaque native ID, and UID when available. Do not invent namespaces for region, account, or node scope.
- Provider request: immutable scope stack, query, limit, AbortSignal, generation. Reject results outside that scope and late generations. Propagate cancellation to native reads where supported.
- Result intent: enter scope, navigate, open resource, open filtered list, setting, or action reference. Labels are display metadata, never lookup identity.
- Action reference: owner-qualified stable descriptor ID and validated target. Reuse SDK type/instance descriptors; extend registration for connection/global actions without embedding arbitrary callbacks in results.
- Availability: ready, disconnected, connecting, authentication-required, forbidden, unavailable; optional typed recovery intent and sanitized explanation. A plugin classifies provider errors; host renders generic states. Do not infer auth failure from arbitrary error strings.
- Resource queries: use shared stores/events. Report incomplete scans and bounded result limits. Current resource search scans only the first 200 objects per type; this cannot support authoritative “no match.”
- Execution: re-resolve registration, owner lifecycle, target identity, descriptor, current availability, parameters, and permissions. Fence stale drawer fetches. Closing cancels reads, not accepted mutations.

Runtime exports `SearchScopeV1`, `SearchProviderV1`, `SearchActionReferenceV1`, and `openGlobalSearch({ scope? })`. Providers continue to register at `omniview/global-search`; there is no second search registry. A result's optional `scope` is explored with Tab or its separate pointer control. Its navigation/action intent is activated with Enter.

Action results contain only an owner-qualified ID and typed target. The current registered provider supplies `executeAction` and optional `validateAction`, with cancellation, generation, validated navigation, and the existing resource drawer available through the execution context. A provider's optional `Context` mounts outside the dialog so shared parameter and confirmation surfaces do not depend on a resource table. Providers must classify connection readiness before resource reads and expose explicit recovery; search never silently connects.

Scope removal restores its saved parent query and selection. Resource identity includes actual namespace and optional UID; changed UID produces a new activation key. Live event refresh coalesces immediate and trailing reads, preserving rows and selected identity. Query/scope/registration changes still fence obsolete completions. Source responses retain typed denial, credential, disconnected, connecting, unavailable, partial, and truncated states.

Unavailable and partial attempted providers expose targeted retry. Retrying replaces only that source's attempt and cancellation signal, preserving other results and selection; timed-out old completions remain fenced. Invalid registrations and truncated/source-limit results do not advertise retry, and accepted executions cannot be retried concurrently.

Live status refreshes defer while a registered action is accepted, then requery current scope after settlement without discarding failure feedback. Query changes, closure, and registration or owner invalidation still fence stale execution. A connection status event emitted before `StartConnection` returns cannot suppress the returned readiness failure.

The host registers generic ResourceClient connection discovery on that same extension point. Connection rows use the owning plugin provider's optional `connectionTarget(connectionID)` navigation callback, validated through normal host navigation admission; without one, they open only the plugin root. The host never invents plugin routes. Only the separately labeled Connect action calls StartConnection and checks returned readiness. The host owns Cmd/Ctrl-K and subscribes to connection synchronization, connection status, and scoped resource events, removing listeners and its registration on teardown.

Unscoped generic discovery emits navigation rows with connection scopes. Host recovery remains available at every scoped depth unless a supporting provider explicitly declares `connectionRecovery: 'provider'`. Navigation adapters alone do not transfer recovery ownership. Healthy connections do not show Connect, pending connections remain connecting, and forbidden connections do not offer Connect as a permission workaround.

Resource drawer reads return a promise and accept an AbortSignal plus a provider-owned identity validator. Only the newest request may open a drawer; close, unmount, or another opening invalidates pending reads. The host rejects unsuccessful reads without assuming Kubernetes data fields. Search requires the owning provider to validate immutable UIDs and awaits this single fenced read.

Abort signals cancel native connection checks and resource Get promises. Superseding, closing, or unmounting a resource drawer also cancels its pending native read. Each bridge removes its abort listener when the native promise settles; identity checks still reject late responses from a backend that finishes after cancellation.

## Pre-implementation evidence and risks (historical)

- `ui/features/command-search/types.ts`: current entries support navigation, settings, and only the host reload-connections command; no typed scopes.
- `controller.ts`: existing abort, epoch/version/readiness fences, provider caps, debounce, timeouts, and activation checks should be extended, not replaced.
- `GlobalCommandSearch.tsx`: already uses base-ui Dialog and CommandList; Tab currently participates in focus containment.
- Runtime resource search reads a bounded first page. Resource lists already consume ADD/UPDATE/DELETE events; search does not.
- Runtime action discovery has descriptors and dangerous-action metadata; action invalidation and resource-list query keys differ. Fix centrally during integration.
- `RightDrawerProvider.tsx`: resource opening reuses drawer factories but needs last-request fencing for rapid selections.
- Native invocation boundary currently receives a nil policy authorizer in `main.go`. Do not describe frontend availability as authorization. Provider/backend permission checks remain necessary.
- Development profile isolation does not isolate kubeconfig or remote cluster side effects. Mock review uses no real credentials.

## Acceptance cases, written before implementation

| ID | Scenario | Required result |
|---|---|---|
| K01 | Cmd/Ctrl-K on host and Kubernetes routes | Exactly one overlay; one dismissal; focus returns to invoker. |
| K02 | Type `pro`, Tab, `pod`, Tab | prod and Pods chips; query clears at each transition; proper suggestions. |
| K03 | Enter versus Tab versus pointer scope control | Enter opens; Tab/control scope; no accidental connection or action. |
| K04 | Empty input, Backspace twice | First selects chip; second removes it and descendants; parent query/selection restored. |
| K05 | Remove connection chip with nested scopes | Clear dependent scopes and cancel reads; never retain orphan targets. |
| K06 | Duplicate names across plugins/connections/namespaces | Distinct labels and full identity; open exact selected target. |
| K07 | Filtered-list result | Destination uses same filter semantics, namespace, type, and connection. |
| K08 | Offline/connecting/failed connect | Explicit recovery; pending state; no live reads before readiness; query retained. |
| K09 | Expired credentials | Reauthenticate explicitly; cancellation/failure preserves search; retry after success. |
| K10 | Forbidden versus empty | Explain denial; do not claim no resources or retry with broader privilege. |
| K11 | Slow/late provider, query change, close/reopen | Old generation cannot change rows, selection, feedback, or drawer. |
| K12 | Partial failure, timeout, result cap | Available sources work; incomplete status and targeted retry remain visible. |
| K13 | Resource add/update/delete while selected | Stable selection; update matching rows; reject deleted/stale UID activation. |
| K14 | Connection removed/plugin unloaded | Invalidate affected descendants and callbacks; explain recovery without silent retargeting. |
| K15 | Logs with multiple containers | Collect container explicitly; open existing log surface with exact identity. |
| K16 | Dangerous action, missing parameters, lost permissions | Validate, collect, confirm, reauthorize; no double dispatch. |
| K17 | Close during accepted mutation | No stale reopening; do not claim rollback or cancellation. |
| K18 | Sidebar/menu/search invoke same action | Same descriptor, parameters, confirmation, result, and cache refresh. |
| K19 | Rapid resource selections | Only latest eligible resource fetch opens existing drawer. |
| K20 | Keyboard/IME/screen reader/narrow viewport | Correct active descendant, announcements, focus trap, text editing, visible query and labels. |
| K21 | Recent/favorite/alias resource navigation | Preserve existing Kubernetes discoverability and ordering semantics in shared search. |

## Approved implementation packets

1. Finalize runtime scope/result/action contracts and migration inventory; agree exact list-filter semantics with Kubernetes.
2. Extend host controller with scoped ranking, identity-stable selection, cancellation, connection readiness, and source states.
3. Extend base-ui only where existing CommandList/input composition cannot support scoped chips and accessible interactions. Keep domain types out of base-ui.
4. Wire shared resource discovery/events, filtered list navigation, drawer opening, and registered action dispatch.
5. Replace Kubernetes local shortcut/palette with host entry points; migrate recents, favorites, aliases and sidebar affordances without duplicate registrations.
6. Run targeted controller regressions, actual browser keyboard/failure journeys, and integrated Kubernetes acceptance. Native shortcut ownership needs desktop verification too.

## Mock coverage and limits

Browser exercised: nested connection/type scopes; filtered-list affordance visibility; resource → logs → container navigation; two-step Backspace; expired-credential recovery. Visual screenshot inspected at 1280×900.

Mock deliberately omits real provider calls, ranking quality, persistent recents/favorites, subscription timing, actual permission checks, action confirmations, native shortcuts, and destination filter wiring. Those require implementation acceptance, not mock approval. Mock parent-query restoration and complete chip editing remain illustrative, not production proof.

Design approved after interactive mock review. Production uses base-ui primitives, not the standalone mock's HTML/CSS.

## Kubernetes consolidation findings

Both host and Kubernetes attach document keydown listeners. Kubernetes ignores `defaultPrevented`; `stopPropagation()` does not stop sibling listeners. Remove the plugin shortcut owner, not merely suppress propagation. Evidence: `kubernetes/ui/src/hooks/useResourceCommandPalette.ts:119-128` and host `useGlobalCommandSearch.ts:166-201`.

Preserve eight deduplicated connection-scoped recent resource types, category/icon/API-version metadata, Dashboard, Helm, CRDs, contributed pages, and selectable parents. The existing flattener omits selectable parents, disabled states, and watch badges; these are parity gaps to fix, not preserve. Favorites and aliases require inventory before claiming they already exist.

Keep sidebar ordering, expansion, settings, and sync controls in place. Search scope changes must not mutate persisted table filters. Explicit list navigation transfers text deliberately and preserves structured filters; final merge semantics need acceptance coverage. Namespace selections persist per connection; cluster-scoped resources must not gain namespace filters.

Existing logs cover Pod regular/init/ephemeral containers and workload targets. Preserve all-container and named-container semantics for Deployment, DaemonSet, ReplicaSet, StatefulSet, Job, and CronJob. Actions cannot depend on a mounted table's DrawerActionsBridge; search needs a valid execution context independently. Session creation failure must leave an honest error, not report success.

Base-ui fit: compose domain scope outside CommandList. Existing Chip supports wrapping but lacks removal/selected-token keyboard contracts. Avoid nested buttons. Dialog needs explicit focus containment, opener restoration, background inerting, and topmost Escape ownership. CommandList keyboard handling requires IME and input Home/End caret checks.

Additional acceptance: exact shortcut modifiers/repeat/consumed events; other-modal ownership; ninth/repeated/stale recent; selected deleted namespace; Pod text plus node/controller filters; metadata columns remaining separate from label selectors; logs without a mounted table; log session failure; workload and init/ephemeral log targets.

Final browser smoke also exercised keyboard selection of the second container (`sidecar`) and Enter activation of the filtered Pods list with `api`. Observed mock outcomes retained prod, resource identity/container, and list text respectively. These are mock outcomes only.

Focus correction: after Tab enters a scope, explicitly focus the search input. The dialog focus trap must ignore already-consumed key events. Browser smoke verified consecutive connection/type scoping without manually refocusing, followed by normal Shift-Tab traversal to the Pods removal control.

## Production verification

Browser smoke used the managed application, not the standalone mock. The selected kind cluster endpoint was verified as loopback (`https://127.0.0.1:63848`).

- A disconnected connection required explicit Connect. The real recovery retained the query, scope, and input focus.
- Consecutive connection/type/resource Tab scopes retained input focus; typing continued without refocusing.
- Live Pod results included namespace identity. The resource scope exposed the shared container-specific Logs action from the home page, without a mounted resource table.
- Activating Logs opened the native log session surface. The smoke session tab was closed afterward.
- Open-list navigation reached the actual Kubernetes Pod table with `?search=coredns`; the table input contained `coredns` and displayed the matching rows.
- Cmd-K on the Kubernetes page produced one overlay; the second Cmd-K closed it.
- Sidebar Find opened a visible connection scope. Escape restored focus to that sidebar control.
- Dashboard remained navigation-only, without an invalid resource Explore control.
- Delete opened the existing resource confirmation; Cancel closed it. No cluster mutation was confirmed.
- Visual checks covered 1440×1000 and 480×900 viewports. Scope chips wrapped without horizontal page overflow; query and removal controls remained visible.

Native desktop/webview shortcut behavior, actual credential expiry, permission changes, and live object replacement were not forced against a cluster. Deterministic regressions cover the corresponding controller, provider, identity, cancellation, and confirmation paths. The production invocation policy-authorizer caveat above remains unchanged.

Initial approved-implementation checks, before the cross-plugin audit below:

| Check | Observed result |
|---|---|
| Focused host search, header, and drawer regressions | 8 suites, 147 tests passed |
| Kubernetes UI full suite | 37 suites, 364 tests passed |
| Host, runtime, and Kubernetes TypeScript checks | Passed |
| Managed launch/build graph | Ready, including bindings, runtime, host, and Kubernetes |

An actual-palette recovery smoke used temporary registered providers: failed source ran once, explicit Retry ran only that source again (`2` calls), and the healthy source remained at `1` call with its result preserved. Input focus returned to search. Temporary registrations were removed afterward.

Use installed Node entrypoints rather than ambient `pnpm exec`, which can implicitly install standalone dependencies. Host Vitest 4 supports `--no-cache --configLoader runner`; Kubernetes Vitest 1 uses `--no-cache` without `--configLoader`. The managed pnpm wrapper is `<feature>/.local/toolchains/pnpm-12.14.0/pnpm`. This audit ran checks in the stopped verification workspace, copied only reviewed source, and let the active workspace regenerate its own outputs.

## Cross-plugin audit and acceptance

The public contract and authoring requirements are documented in [plugin development](plugin-development.md#scoped-global-search). Search does not impose Kubernetes object metadata, namespace display labels, action components, or plugin routes on other resource plugins.

| Scenario | Required behavior and regression coverage |
| --- | --- |
| More unrelated providers than the source cap | Route the scoped owner before scheduling; unsupported/foreign providers cannot starve it. |
| Static action or missing/wrong-owner executor | Reject the contribution/result instead of showing an enabled no-op. |
| Disconnection under resource/object chips | Offer same-connection ancestor recovery without dropping chips or the query. |
| Broken navigation adapter | Preserve other adapters and healthy connection discovery. |
| Expired credentials or forbidden access | Classify accurately; never connect automatically or bypass permission denial. |
| Native subscription failure or late acquisition | Keep readable rows, expose targeted live-update retry, retain healthy watchers, and release late success. |
| Event storm during a slow query | Preserve stable rows/selection, bound refresh work, and publish the final snapshot. |
| Event arrives while React Query fetch is active | Re-invalidate after settlement before the trailing read; do not lose the final update to cache freshness. |
| Table cache receives a batched update | Preserve successful GetResult shape; detail hooks and search consume the same updated object without another native Get. |
| Memo/lazy plugin Context, replacement, or failure | Supply the real owner, preserve dialogs after palette closure, clean replacement/unregister, and isolate failed sources. |
| Native object has no Kubernetes metadata | Use provider validation, not hard-coded metadata fields. Preserve opaque IDs and actual namespaces. |
| Removed connection or replaced object | Clear authoritative orphan scopes; reject stale identity and retired activation keys. Do not recommend reconnect for an unrelated object failure. |
| Configured connection never started or stopped | SDK readiness returns DISCONNECTED without probing an absent client. Unknown IDs remain errors; active errors remain errors. |

The current SDK Get wire cannot represent all native account/region/node collisions. Providers must not fabricate namespaces or compound native IDs to hide that limit. Provider-owned navigation/action entries remain available where generic Get cannot address an object honestly. Search activation checks also do not replace backend authorization or atomic mutation preconditions.

Actual browser audit used the loopback kind cluster only. An injected SubscribeResource transport failure left Pod results usable with the live-update banner. Retry acquired the native subscription successfully (HTTP 200) and restored input focus. The shared container Logs action opened the real log surface from the home page.

The SDK inactive-readiness regression failed before the fix for both never-started and stopped connections, then passed with the full resource suites and targeted race checks. No production cluster mutation was confirmed.

| Runtime measurement | Observed result |
| --- | --- |
| 26 injected Wails UPDATE notifications while the first List response was held in flight | 2 List RPCs; 3 rows retained; selection and input focus preserved |
| 3 successive list-query refinements | Reused the same native list snapshot |
| 3 successive action-query refinements | 1 object Get |
| Executing the shared Logs action | 1 additional authoritative Get |

The injected events exercised frontend refreshes without modifying cluster objects. That audit's keyboard/DOM geometry checks at 480×900 retained all three chips and input focus without horizontal overflow. Screenshot tools timed out during that earlier run; settled screenshot captures succeeded in the later refinement verification below. Desktop sidebar Find and Cmd-K also opened one overlay and restored sidebar focus.

| Previous cross-plugin audit check | Observed result |
| --- | --- |
| Focused host search, context/cache interoperability, header, and drawer regressions | 10 suites, 173 tests passed |
| Kubernetes UI full suite | 37 suites, 375 tests passed |
| Host and Kubernetes TypeScript checks; runtime TypeScript and production bundle | Passed |
| SDK resource package subtree and targeted readiness race checks | Passed |
| Tested source migrated to active workspace | 52 code/test files matched SHA-256 checksums |
| Managed reviewed workspace | Ready; dependencies and served source current; HMR connected |

## Latest interaction and icon refinements

Global opening from a Pod view now seeds only its connection. Resource-type and object scopes remain available through explicit Tab exploration. Removing the connection chip clears dependent scopes and keeps the session unscoped; reopening resolves the active connection again.

The plugin-owned icon extension point serves both sidebar layouts, search rows, and scope chips. Kubernetes glyphs are adapted from the attributed upstream artwork: badge backgrounds/borders are removed and inert SVG geometry inherits `currentColor`. Unknown resources retain a monochrome fallback. Trusted inline assets eliminate the cross-origin URL mistake that previously replaced valid plugin artwork with generic fallback icons.

Typing preserves the previous rows until replacement results settle and blocks obsolete actions. The base CommandList no longer applies a second label-only filter to the controller/provider's ranked results. Availability uses compact icon badges with full messages behind Details, rather than repeating connection instructions.

| Actual browser check | Observed result |
| --- | --- |
| Global opening from the actual Pod route | One connection chip; no automatic Pod chip |
| Manual Tab exploration, chip dismissal, and reopen | Deeper scopes remain available; dismissal stays global; reopen returns to connection only |
| Input-to-first-result gap | 4 CSS px |
| Arrow-only scope control | 21×24 CSS px; no visible text label |
| Chip removal structure | Inside chip; no nested buttons; input focus preserved |
| Native and fallback resource glyph colors | Both inherited `rgb(140, 140, 140)` in the inspected theme |
| Typing `pods` | 20 rows replaced by 4 rows with one dialog geometry change; input focus preserved |
| Disconnected visual feedback | Compact icon badge; verbose message hidden until Details; temporary proof source removed |
| Responsive header opening | 480 px viewport and document width; one connection chip; focused input |

Settled screenshots captured both desktop and narrow layouts. Sidebar also rendered the shared native glyphs. No cluster mutation was performed.

| Final refinement verification | Observed result |
| --- | --- |
| Focused host search, routes, builtin ownership, header, and drawer checks | 12 suites, 226 tests passed |
| Kubernetes UI suite, including native artwork behavior | 38 suites, 379 tests passed |
| Runtime icon ownership, lazy loading, failures, and replacement | 1 suite, 6 tests passed |
| Host and Kubernetes TypeScript; runtime TypeScript and production build | Passed |

## PR review and release integration

CodeRabbit reviewed the host, Kubernetes, and SDK changes. Review corrections admit action-provided resource destinations before dispatch, enforce provider ownership, normalize absent or malformed global-open event details, and update Kubernetes action dependencies only after commit. Native cancellation fixtures preserve the cancellable promise rather than wrapping it in an async function.

The resource cache regression now runs without an external Kubernetes checkout. Keyboard E2E checks validate the actual first/last focus boundary instead of pinning an incidental control order. The obsolete approval mock is excluded from the release.

Foreign-owner, wrong-kind, and malformed resource destinations reproduced erroneous dispatch before the fix. A null-detail global-open event reproduced failure to open before the fix. The corrected host cohort passed 230 focused tests, full host lint, and TypeScript. The real managed application opened a focused dialog for null detail and wrapped keyboard focus between the first control and the final Details control.

Release integration targets SDK v0.7.1, host/runtime/providers/Vite plugin v0.7.4, and Kubernetes v0.7.1. Consumer manifests use published dependencies, never local replacement paths.
