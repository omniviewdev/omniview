# UI extensions v1: host behavior and release tests

**Proposed for owner review. Not approved, implemented or released.**
The owner chooses a place. A contributor supplies a fact, a menu item or the body of a view.
The host owns admission, navigation, focus, and the lifetime of anything it discloses.

| To review… | Start here |
|---|---|
| The four user interactions | [Owner brief](../status/KL-rest.md) · [Worked examples](extension-view-scenarios.md) |
| What authors declare, ship and receive | [Public API and wire reference](extension-api-v1.md) |
| What a sidebar click must do | [Owner location and tab history](#owner-location-and-tab-history) |
| Which Pod a terminal menu acts on | [The terminal belongs to its session](#the-terminal-belongs-to-its-session) |
| What can fail without taking down the page | [Activation and retirement](#activation-and-retirement) |

## Owner location and tab history

### Why the lab left Kubernetes

In the experimental `workspaces/extension-lab/omniview` checkout, `ui-next/plugins/host/sidebarNavigation.ts` built
`{plugin: peer.id, contribution: page, params: {}}`. Its `PluginHost.choose` passed that route to
`tabs.open` with the ordinary sidebar disposition. That is a request to **visit the other plugin**.

In the [tab model](../../../ui-next/shell/core/tabs/open.ts), unmodified `smart` open first looks
for an existing destination. Otherwise, it can reuse the current document for the same plugin
and scope; a different plugin normally gets a new tab. The [frame](../../../ui-next/plugins/host/PluginHost.tsx)
follows a change of active tab or plugin. A plugin-scoped custom page also
[drops the connection](../../../ui-next/plugins/host/contributions.ts).

This explains both symptoms: the tree changes and Back no longer leads to the Deployment.
The selected tab shows **its own** history; a newly opened tab starts with one entry. The symptom
does not establish that the shell erased the original tab's stack. Forcing `here` on the **peer**
route fixes only half the problem: Back can work but the frame still changes.

Its sibling `native-run/kong-acceptance/prove.mjs` checked the peer heading and absence of an inherited connection. It did **not**
check the document tab ID, Kubernetes tree, scope lane or Back → Forward. Its five warm sidebar
timings measure the rejected behavior.

### A mounted view is a different kind of location

For a `sidebar` point, add a host-only, tagged alternative to the shell's ordinary page location.
For example, clicking **Kong Admin** constructs this place inside the shell:

```ts
{
  kind: 'extension-view',
  plugin: 'kubernetes',          // owner of the rail, tree, scope and history location
  point: 'sidebar-pages',        // local to that owner
  offer: 'kong-admin/manager',   // installed contributor and its local Body offer
  connection: 'west'             // owner's route locator, not a credential or Body prop
}
```

Its key is the full tagged tuple, not a page key, label, DOM ID, index, or contributor ID alone.
It is **never a singleton**. An ordinary plugin may already have a page called `manager`;
neither that page nor an owner page with a similar name can shadow this location.
Only the host builds it from the exact admitted binding. Do not add a plugin-supplied URL,
an arbitrary parameters bag or a second plugin router.

- **Frame:** select the owner's rail entry and exact contributed leaf. Keep the owner's tree
  instance, expansion, ordinary node source and scope picker; mark the leaf current.
  The document face and breadcrumb can say `Kubernetes › west › Kong Admin`. Only the main
  content region draws the selected Body. Do not ask a contributor's landing, home, page hook
  or sidebar to supply chrome. A contributor needs no standalone page or rail entry.
- **Scope:** use the authorized scope of the *displayed owner sidebar*, including when another
  plugin's document was previously active. If this owner workspace requires a connection and
  none can be verified, there is no mount. Never guess the first cluster, use the last
  contributor connection, or carry across another tab's params. Omit `connection` only for
  an owner workspace that is genuinely unscoped.
- **Disclosure:** in v1 the sidebar point has empty input, no condition and no related read.
  Binding consent is still required. The Body receives `input: {}`, not the location above,
  Kubernetes credentials, a cluster client or `ContextV1`. Showing an admin view does not
  authorize administering a cluster. A standalone peer page, if present, stays independent.

### Press, Back and Forward

Treat a plain press as **navigate this tab**, not smart open. Re-resolve the leaf and its grant
at dispatch. Capture the initiating tab and its current location; a delayed confirmation, import
or menu event must not navigate whichever tab later became active. Honor the tab model's
unsaved-changes confirmation; a refusal, cancellation or stale press makes no history change.

```text
One workspace tab T                  History in T (* = cursor)
Deployment gateway-sample            [list, Deployment*]
Press Kubernetes › Kong Admin        [list, Deployment, Kong Admin*]
Back                                 [list, Deployment*, Kong Admin]
Forward                              [list, Deployment, Kong Admin*]
```

On a different location use the equivalent of
`tabs.navigate(T, destination, {history: 'push', reuse: false})`. Identical place: no duplicate
entry. Keep all earlier entries within the shell's normal cap. A new push **after Back** drops
only the forward branch. A matching tab elsewhere is not a reason to focus it. With no document
tab, create one; there is no fictitious prior page. Never reset the strip, replace the prior
entry, change `window.location`, or push a second history for the Body.

Back and Forward step the existing cursor without pushing again. Restore the owner route,
scope, tree selection and the previous page's bounded in-window UI state (e.g. scroll and
owner subtab) where still valid. This is not restoration of a previous data answer.
An in-page Deployment or Service tab selection itself is **not** document navigation.

The connection picker is a distinct user intent. Extend the existing
[`switchTab`](../../../ui-next/plugins/host/connections/actions.ts) scope-change path to recognize
the mounted location: check the chosen owner connection, then resolve the same point/offer there,
under a fresh lease. Use the shell's scope-change semantics (replace the current entry or show
its existing matching tab), **not** sidebar press semantics. Do not let an unknown page key
fall back to the owner's home, keep the old Body alive, or hand it the newly selected connection.

Use the [shell disposition mapping](../../../ui-next/shell/core/tabs/disposition.ts), with
plain = `here` for these leaves. Do not change ordinary page or rail behavior.

| Gesture on a contributed leaf | Result |
|---|---|
| Plain click, unmodified Enter/Space, or Alt/Option-click | Push in the initiating tab, as above. |
| Mod-click or middle click | New **background** tab; no change to original focus, selection or history. |
| Mod+Shift-click | New foreground tab, not deduplicated. |
| Shift-click | New workspace window when supported; otherwise report refusal and leave the source alone. |

Mod is Command on macOS, Control elsewhere. Explicit new tabs/windows start with only the
destination. The [tree](../../../ui-next/shell/Tree.tsx) currently forwards click and plain
keyboard activation; carry middle-button `auxclick` through once for this gesture, not as a
second plain press. Preserve group expansion, roving focus and normal arrow keys.

### Hash, session restore and loss of a peer

The current [hash parser](../../../ui-next/plugins/host/route.ts) accepts external requests; the
shell does **not** mirror a tab's internal back stack to browser history. Keep ordinary
`#/<plugin>/<page>` addresses unchanged. For a shareable sidebar mount use a distinct host
address; for the example above:

```text
#~view/1/kubernetes/sidebar-pages/kong-admin/manager?connection=west
```

1. Bound the new address to 8 KiB of UTF-8 before decoding. Parse its prefix **before** ordinary
   page parsing. Require the version, exactly four ID segments, and at most one nonempty
   `connection` query value (decoded UTF-8 ≤2 KiB). Encode/decode each component once. Reject
   malformed escapes, extra paths/keys, duplicate keys and unknown versions. Use only a
   non-secret owner key suitable for an ordinary route; never silently shorten it. An invalid
   request cannot fall through to Home, start a backend or select a cluster.
2. Support the tagged location in normalization, equality, face/key derivation, frame and tree
   selection, tab navigation, [`step`/`refresh`](../../../ui-next/shell/core/tabs/arrange.ts),
   [session serialization/repair](../../../ui-next/shell/core/tabs/persist.ts), reopen and window
   transfer. Today's ordinary completion substitutes home for an unknown page; **never** feed a
   mounted location through that branch. Version the saved route shape and read older ordinary
   sessions unchanged. The tag is host data, not a new public `RouteV1` input.
3. Persist/transfer only the locator and ordinary tab bookkeeping. No live render, scope key,
   predicate result, projected props, related rows, read authority, session origin or menu choice.
   Treat a saved face/key as untrusted, not proof of a binding. Keep the existing limits: up to
   50 route entries in memory, 10 around the persisted cursor; no persisted page-local state.
4. On a deep link, Back/Forward, reopen, window transfer or foreground restore, rebuild from
   current inventory, owner sidebar declaration, scope, live binding grant and both artifact pins.
   Background restore/new-tab records a place only. Unknown policy or loading inventory may
   show a local pending state, never cached peer content. A valid foreground visit is fresh demand.
   A plain external link uses this tab or creates one if absent; consume it once.
5. If a *current* binding disappears, immediately unmount the Body, withdraw the leaf, and keep
   the cursor and history. Show a neutral **View unavailable** in the owner frame, with Back
   when available and usable owner navigation. If the owner itself is gone, use the shell's
   unavailable-owner surface. Do not redirect, auto-select a replacement or close the tab.
   Forward to that place while denied has the same result, with zero peer execution. Regrant
   does not replay an already withdrawn mount: require a fresh selection, traversal or Retry.

A broken/transient **press** leaves the source untouched; a well-formed **saved location** can
remain addressable but unavailable. This distinction preserves history without preserving access.
There is no separate public address for a contributed detail subtab in v1: an ordinary resource
deep link or cold restore opens that resource under normal owner selection, never a stale peer.

## Admission and disclosure

### Admit declarations, not code

1. At install/update, inventory completed, trusted, verified package bytes under the installed
   plugin ID and artifact digest. `assets/extensions.v1.json` is generated metadata
   (`schemaVersion: 1`); `assets/extensions.js` holds scalar functions; `assets/views.js` holds
   named view Bodies. An asset exists only when the author contract requires it.
   `assets/entry.js`/`contributionV1` remain the [ordinary page seam](n19-plugin-seam.md).
2. Use the same bounded, closed decoder at build and host admission. Reject unknown members,
   duplicate JSON keys, duplicate local declarations/edges, bad lengths, malformed IDs, surplus
   exports and contradictory contracts. An offer for an absent external owner can be parked;
   absence is not an install or activation request. No discovery by evaluating modules,
   querying plugins, probing missing files or resolving npm packages at run time.
3. Bind every asset to the **same verified installed artifact**. Reject traversal, overlays,
   redirects or replacement bytes under an old digest. Bound sizes before parsing, buffering
   and evaluation. Neither a version string, an event nor a cache-busting URL proves identity.
   A bad replacement atomically withdraws that source's former extension declarations/work.
   Keep unrelated sources and independently valid ordinary pages intact.
4. Resolve **explicit** `(qualified point, qualified offer)` edges. The installed point owner
   controls its local mounts. A binding must match the placement, kind, exact protocol major
   and full compiled definition, including optionality and any named read/row contract.
   Compare maps by key/type, not serialization order. Never infer a match from a label,
   look-alike schema or npm version. Published definitions cannot be shadowed; a private point
   belongs to its protocol owner. A disagreement between independently valid sources parks the
   edge, not the whole page. `[package, version, export]` identifies a developer import only.

Check host switch, profile, trust, compatible capability and enabled/Running generation of both
ends. An owner supplying an ordinary UI adapter must pass ordinary admission too. A peer with
only scalar features or view Bodies needs no home, page hook, placeholder entry, sidebar or rail.
No contributor can claim the `host` identity, install a dependency or recursively invoke a peer.

**Production trust boundary.** Extension admission starts with a completed, verified registry archive. A development overlay, an unsigned local install, and an older installation without a verified inventory cannot establish an extension source. None acquires trust by declaring a digest or by receiving a grant. Ordinary pages keep their existing admission path.

For an extension owner, ordinary page admission also names the active installation generation. Its entry and relative chunks resolve under the verified package, not the mutable plugin URL. A route-less contributor has no ordinary page to load. The catalogue can describe a point before consent; that does not make the point eligible.

### Form one binding's projection

- **Consent:** the host records consent per profile, qualified point, qualified offer, exact
  contract and **both installed pins**. Show placement, purpose, packages/pins, requested fields,
  whether code renders/runs, and any separate related read. No self-grants, wildcard or
  transitive grants. A changed digest requires reapproval. A restart with the same pins still
  starts new lifetimes. An explicit empty grant may allow unconditional `{}`; no grant never does.
- **Fields:** intersect *owner-declared ∩ offer-requested ∩ operator-granted*. An ungranted
  key is absent, not `undefined`, null or a made-up value. Never inspect or measure a denied
  descriptor. Read only own enumerable data properties of finite numbers/bounded strings.
  Copy into a frozen null-prototype snapshot. Reject effective getters, inherited values,
  nested records, credentials and excess bytes. An absent declared optional field stays absent;
  a missing required effective field or malformed present value cannot be disclosed.
- **Match:** for a conditional menu/view binding, `when` is a conjunction of 1–4 distinct
  `{field, equals}` tests. First establish **all** tested fields are requested and granted.
  Then compare present scalar values with exact type/value equality. No string coercion,
  truthiness, callbacks, selector language or inspecting the remaining projection on nonmatch.
  A missing/denied test field means **no entry**, not a disabled hint. The entry itself can
  disclose an attribute. Recheck on selection. Sections and empty-context sidebars do not query
  attributes to decide eligibility.

For example, a Pod-type predicate and an optional `managedBy` test both have to pass. One
missing label suppresses that offer; it cannot hide an unconditional sibling.

### Change policy without leaking old output

Store policy outside plugin assets. Only host operator controls write it. Use a private,
bounded, atomically replaced snapshot and fence stale reads. Unknown, malformed, duplicate,
unreadable, insecure or unwatchable policy fails closed, never “last known good.” An unknown
target or stale pin in an otherwise valid policy does not disable an unrelated valid binding.
Subscribe all windows, invalidate immediately, and resubscribe/reread on reconnect; notifications
confer no authority.

While uncertain, stop new reads, code, navigation, hints and publication of **success or failure**.
Remove sensitive output. Fence even revoke → regrant to the same field list. Reuse an unaffected
row only when grant continuity is proven; irrelevant keys/reordering do not invalidate it.
Withdrawal cannot recall previously disclosed data from trusted code.

**Operator control:** see the [private profile policy format](../../../backend/extensionpolicy/README.md). Only a native, profile-scoped snapshot supplies grants. No Wails mutation method exists. Losing the event transport withdraws window authority until a fresh inventory and policy arrive; the ordinary shell remains available.

## Rendering the four placements

| Owner's placement | Cold/listing behavior | On demand |
|---|---|---|
| `overview-section` (`section`) | Visible Overview `outlets` follow owner sections in the main column. | Request one `{label, value}` fact per eligible binding. Draw escaped text in a kit card. |
| `detail-tab` (`view`) | `DetailView.tabOutlet` extends the owner's strip independently of which owner tab is selected. Append eligible labels from metadata. | Select the peer Body **inside the existing tabpanel** for this authorized resource. |
| `context-menu` (`menu`) | A published `menuOutlet` adds rows to this owner's menu, not to every menu. No rows means no extra separator or trigger. | `info` computes `{text}`. `openView` asks the host to resolve one exact mounted view. |
| `sidebar` (`view`) | `contributionV1.sidebar.outlet` opts the ordinary resource tree into one group after owner nodes. Not the landing or connection picker. | Navigate to the owner location above, then mount the named Body in the main area. |

All points accept many contributors. Keep owner entries first and unchanged. At a point, order
eligible rows by full **ascending ASCII qualified offer ID**. Equal labels remain separate;
disambiguate visually and accessibly with qualified IDs. Never sort by evaluation time, install
order, label or priority. Outlets across a page keep owner order.

Use point/offer keys, not row indices. Reserve all owner sidebar IDs including descendants.
A generated group collision suppresses that group; a leaf collision suppresses only that leaf.
Avoid owner tab-ID collisions deterministically. A stale extension key never falls through to a
page, connection or home. Reject foreign mounts; honor the first repeated section outlet only
and diagnose the duplicate. No eligible content means no gap, marker or focus stop in normal mode.

### One resource, one detail strip

Selecting a Deployment tab or **Service → Topology** changes only the panel. Keep the document
tab ID, resource route, connection, header, breadcrumb, list leaf and document history. The Body
is **not** an ordinary page `Body(context)` mounted with owner authority. It receives only its
`ViewProps`: the effective `input`, and `related` only for a requested, declared read.

Use the [kit's tablist and tabpanel](../../../packages/kit/src/components/Tabs/Tabs.tsx):
one roving tab stop; Left/Right wrap and Home/End select endpoints. Those keys actually **select**
under automatic activation; click/Enter/Space can also select. Bare focus, hover and listing do
not mount. Render the selected Body in its own labelled, bounded region. Allow kit layout and
local interactions, including an accessible list/table alternative to a relationship graph;
no supplied portal, document-wide CSS, raw router, connection handle or command dispatcher.

Props alone do not close an ambient capability. The normal [`LinkProvider`](../../../ui-next/plugins/host/links.ts)
generates hrefs and dispatches navigation with the page owner's plugin and connection. Do not
let that provider (or any owner panel, connection or navigation context) reach the view Body.
Theme and kit presentation can be shared; a contributed kit `Link` must neither emit an
owner-scoped href nor navigate as the owner. Use local view controls for graph/table drill-in.

Deselect, hide, lose authority or change object incarnation: unmount the Body and fence its reads.
On loss of the selected row return to the last valid owner subtab, else the owner's default.
Restore focus there if the removed panel held it. A remembered in-window choice may restore only
for the same verified object and continuously eligible binding. New admission, cold restore or
regrant alone never selects a contributed detail tab.

### Menu items are not terminal commands

An Overview may publish its own named menu. A terminal surface may attach different owner
points to a menu that already contains native actions. A source may offer either:

- **`info`:** on explicit selection call only the named scalar feature. Present pending,
  result or host-authored error in a local, named atomic status for the triggering context.
  Never render returned text as a URL, HTML or a command.
- **`openView`:** no menu feature runs. Resolve the action's qualified view point and
  contributor-local view offer in the **same owner's** workspace. Check source and destination
  bindings, both grants and each placement independently. The menu grant cannot supply view
  inputs, related-read permission or a route. A known-ineligible target is not offered.

A sidebar destination uses its owner mount in the source's verified owner scope. A detail
destination needs the owner's verified resource locator and incarnation. If already on that
object, select its eligible tab without a history push. Otherwise push the authorized **owner
resource** in the initiating workspace tab. Carry a one-use host intent for that exact binding
and incarnation, not props. Wait for the actual ready detail outlet before selecting. If the
object, target, predicate or grant no longer matches, discard the intent; leave the authorized
owner page usable. No implicit page, replacement object or fallback view. The intent is never
saved, transferred to another window or reissued on Back.

Opening, arrowing, typeahead, bare focus and Escape never invoke the peer or read related data.
Enter/Space/click chooses once. Use the existing menu's keyboard and dismissal behavior;
Escape returns focus to its trigger. `info` leaves focus there. Successful navigation places
focus at the destination's named content. A withdrawn trigger returns focus to a surviving
owner control, not the document body. Do not move focus when another offer arrives.

## The terminal belongs to its session

There are **two** context menus. A secondary click on a session tab is not a click in xterm,
and neither is the workspace tab strip or a Pod detail-page menu.

| Hit target | Host owner today | Keep intact |
|---|---|---|
| Terminal **session-tab header** | [`SessionTabs`](../../../ui-next/shell/panel/SessionTabs.tsx) keys one `useMenu` by the clicked session ID. | Rename, Stop where applicable, Close and close sets; a right click may hit a non-active session. |
| Terminal **screen/input** | [`useTerminalMenu`](../../../ui-next/shell/panel/terminal/menu/useTerminalMenu.ts) composes the emulator's menu and guards program mouse reporting. | Copy/Paste, Find, command/output tools and native keyboard/focus behavior. A mouse-reporting app keeps its click unless the user forces the menu with Shift. |

**Session bridge:** the host owns the menu; the plugin that owns the resource may supply
`contributionV1.panel.sessions.terminal.useMenuOutlet(origin)`. Its `origin.surface` is
`'session-tab'` or `'terminal-body'`. Publish a distinct local point and grant for each surface
that opts in. Never mirror a tab item into the emulator, or register a global `contextmenu` hook.

1. **Bind provenance when a resource terminal opens.** The host needs the authenticated
   producer, owner-local detail locator, verified owner connection and object-incarnation key,
   bound to that session and launch/attach generation. The [`TerminalTarget`](../../../ui-next/shell/panel/terminal/feed.ts)
   display label/kind/route and session title are not proof. The connection-bound
   [`PanelHostV1` resource shell opener](../../../ui-next/plugins/host/resourceShells.ts) checks a live
   record from the owner and acquires a window-bound native attachment. The host rechecks it before
   dispatch. A restored tab has no such attachment. Never infer provenance from its title or active page.
2. **Open on the hit session.** Right click, Menu key or Shift+F10 resolves that trigger's
   session and surface without activating a different terminal. On the body, honor the native
   input and mouse rules first. Keep built-ins available immediately. Consult only that
   session's owner adapter, behind its own boundary and after static point/consent screening.
   The owner revalidates the authorized resource and returns `{extensionScopeKey, extensionRoot, outlet}` or
   nothing. Match the current row's full resource identity and connection to launch. No witness or usable projection: no contributed rows.
   In a split terminal, each visible pane can offer its own body menu. Moving focus to a sibling
   does not retire the result; replacing or hiding the target pane does, even if its session tab remains.
3. **Fence a menu opening.** Keep a host-only token for window, trigger, session ID and
   generation, surface, producer, subject/connection, resource incarnation, both source
   lifetimes, binding revision and opening sequence. Evaluate the granted predicates on
   the current projection. Do not subscribe every tab to the resource store or wait on a
   backend to display native actions. The owner can obtain fresh facts for the targeted
   session, not fan out to every terminal. Unresolved/denied facts never create interim items.
4. **Choose or retire.** Watch that exact row revision, not its coalesced React subscription. Native admission
   rechecks the current witness and original attachment before dispatch, before cold feature input disclosure,
   and before displaying a result or error. Session A selected while right-clicking B must use **B**, even if both titles
   match. Reorder never retargets by index. Close, replacement, held/ended session, disconnect,
   takeover/reattach, window loss, invalidated attributes, lease/grant loss or a superseding
   menu invalidates the opening. Dismiss stale rows; abort superseded reads; discard late
   results even if code ignores cancellation. Dismissal after a valid `info` selection transfers
   only that invocation to a fresh, session-bound result lease; Escape dispatches nothing.

For a local shell, unverified/foreign session, forged origin, different Pod with the same name,
or restored session with no verified origin: native menu only. A held terminal's existing
output remains the user's; removing an extension must not close the session or clear output.
The terminal [registry](../../../ui-next/shell/panel/terminal/TerminalSessions.ts) owns feed
and attachment lifetimes; matching a Pod attribute gives no access to the feed.

Never pass session IDs/reattach keys, stdin/stdout, scrollback, selected text, argv, environment,
working directory, clipboard, exec/kill/paste callbacks, container handles or credentials to the
peer. A read-only menu grant cannot type, run, reconnect, stop, copy, forward a port or mutate a
resource. Native owner actions retain their own checks.

## Reading related data

One separately authorized read may enrich a selected detail Body. This is how an interactive
Topology can show **both directions** without shipping a generic cluster client to a contributor.
See the [Service example](extension-view-scenarios.md) for what constitutes an actual edge.

1. The owner's view protocol names a fixed `read: {id, row}` and documents semantics. The offer
   explicitly sets `requestRead: true`. Neither the mount grant, its scalar fields nor a peer
   supplying the same read ID authorizes rows.
2. The host broker dispatches **native `ReadRelatedV1`** only on current selection, under
   separate consent for that exact read/binding and both pins. Derive authenticated principal,
   owner, operation, connection and verified root object/incarnation from the private mount.
   The peer supplies no query/resource ID, filters, cursor, callback or token.
   The owner obtains an opaque `ExtensionRootV1` via owner-only `extensionRootOf(record)` from
   the existing `@omniviewdev/runtime/ui/v1` API and supplies it as `DetailView.extensionRoot`.
   It must come from the actual current native-attested record. A clone, stale record,
   unsupported source or matching string `extensionScopeKey` cannot substitute. Native
   authority rechecks the root on every read. Never pass this witness to the peer or save it in a route.
3. The owner backend authorizes the current root **and related evidence** under the current
   subject's rights. The trusted broker verifies the operation, binding, root and private
   canonical citations for the evidence and any resource neighbor before disclosure. Only
   authorized evidence may support an address-only endpoint. No citation enters view props.
   Hide unauthorized neighbors, counts and reasons. No JS hook stands in for backend authorization.
   If this authority path cannot be established, the read is unavailable; do not grant a
   scan, guess from names, or fall back to an unscoped cache.
4. Validate exact bounded scalar rows and publish an immutable `related` state for this lease.
   `loading`, `unavailable` and `failed` expose no rows. `ready` carries `rows`,
   `coverage: 'complete' | 'partial'` and `truncated`. **Known empty** in a direction requires
   complete, untruncated authorized evidence and zero rows in that direction. `truncated`
   means extra *authorized* rows, not proof of a denied edge. Derive complete coverage from
   independent scope-wide authorization and exhaustive acquisition, never from the absence of
   a denied candidate. Partial knowledge is never “none.”

One active selected read per window, 5 s deadline, at most 128 rows **total across directions**,
1–64 declared fields per row and ≤64 KiB compact UTF-8 for the entire public ready value,
including `state`, `rows`, `coverage` and `truncated`. Bound broker and
backend work **before** materializing the result; no unbounded collect-then-slice, watch,
streaming updates or pagination. A read-only denial may leave the scalar view available with
`related` unavailable. On read revocation clear rows and remount any Body that could retain
them. On mount loss withdraw the whole Body. Fence late values **and errors** in both cases.

## Activation and retirement

### What exactly is live?

| Lifetime | Opens when | Fence immediately on |
|---|---|---|
| Source | Manager inventory and pinned bytes agree on a Running installation. | Stop/disable, crash, reload/rebuild, update/uninstall, ambiguous reconnect. |
| Binding | Exact compatible pair, valid policy revision and no disable. | Either pin/lifetime changes, revocation/reissue or effective disclosure changes. |
| Placement | Current visible owner outlet recognizes the authorized scope. | Hide/deselect, object or connection replacement, holder change, superseding visit. |
| Demand | One actual selection or one visible automatic section needs work. | Superseding request, invalid placement/binding, timeout or window teardown. |

Subscribe before taking inventory; share one authoritative read with normal page discovery.
Retire immediately on unload even if an older snapshot says Running. Coalesce unrelated
refreshes. Reject reads spanning an invalidation. Enable alone does not mean Running. On event
gaps, retire uncertain sources before rereading. Retire incoming points and outgoing offers
together; evict code and hints. Teardown removes listeners, timers and pending work.

For an object-bound detail mount require a ready `usePage(...).source.view.extensionScopeKey`
(`DetailView.extensionScopeKey`): a nonempty opaque string ≤256 UTF-16 units, supplied **after**
matching the returned resource and connection to the owner route. It changes on same-name
replacement. Terminal mounts check the independently bound launch key above; sidebar mounts
check owner workspace/scope rather than borrowing an arbitrary detail key. A key alone is
not authorization. Never expose it as a prop, predicate, URL, telemetry or persisted state.
No executable object placement from loading/denied/missing/retained-failure data even when
the owner deliberately keeps its own old content visible.

Give each invocation a token for source lifetimes, binding revision, placement lease (including
subject and incarnation), current scalar snapshot and demand. A → B → A is three leases.
Identical values on a newly created object never preserve authority; newly allocated equal
snapshots on the same live object need not force work. Recheck before projection, after
potentially reentrant descriptor access, before/after import, before provider call or mount,
after settlement and at display. Invalidate synchronously; not one paint of old data while
an effect catches up. Use cooperative abort, but never depend on cooperation to suppress results.
Key view state to the live binding revision and object, not just the stable tab ID. A narrower
field grant must retire local Body state that could otherwise keep displaying withdrawn values.

### Load only what this interaction needs

| Demand | May load | Must not run |
|---|---|---|
| Catalogue, tree/list of choices, menu open/keyboard movement | Metadata; gated owner facts if needed for membership | Contributor feature or view module, Body or related read |
| Visible admitted section, or chosen `info` item | `assets/extensions.js`; call only the named export `(input, signal)` | Other functions, Bodies or arbitrary result renderers |
| Visible selected sidebar/detail view | `assets/views.js`; mount only the named Body as a component. Run a requested read through the broker only. | Contributor landing, ordinary page hook or generic runtime/data backend |

Preflight fixed pinned assets. The scalar module is self-contained and dependency-free at its
boundary. The view module may share **only** the author contract's React/JSX and kit surface,
not the broader ordinary page allowlist, a second React, shell objects or a backend runtime.
No contributor-supplied loader, remote URL, follow-on import, global style or top-level
registration. Share one in-flight import and evaluation **per window, source generation and
asset kind**; cancellation by one caller cannot revoke another caller's valid demand.
Share code, never an invocation, local state, projection, read or result across bindings.

Validate exact own scalar results, size and text bounds before painting. A view is the
selected component, not JSON/HTML returned by a generic render function. Its local boundary
owns loading, timeout, render failure, unmount and focus recovery. Bodies may draw kit controls;
they cannot override owner chrome or introduce undeclared reads/writes through this contract.
These are trusted plugins in one JS realm, **not** hostile-code isolation. A suspended or
synchronously blocking plugin cannot be forcibly interrupted by a JS deadline. A deployment
that cannot establish trusted code and an authorized subject/scope must leave these placements off.

Keep owner content and ready siblings live. A fault in the owner's projection/adapter belongs
to the point; a missing export, throw or invalid result belongs to the offer; a failed
authorized read belongs to its read stage. Use host-authored local messages, never inspect or
format a thrown value (including `message`/`cause`). Fence obsolete errors just like successes.
An explicit Retry/selection can retry under new authority. No page-wide Suspense, automatic
selection, retry loop or replay of a menu press. Dropping references does not unload JS from
the realm or revoke facts it already saw.

## Operating limits and performance

**Proposed bounds, not measurements.** Reject invalid metadata atomically; never truncate
declarations, execute over-budget work or displace an owner action.

| Boundary | Limit |
|---|---|
| Package/policy | Metadata ≤256 KiB; feature and view JS ≤1 MiB **each**; private policy ≤1 MiB. At most 1,024 per source per declaration list and 1,024 grant rows per profile. |
| Scalar data | ASCII ID segments ≤128, positive major ≤9 digits; ≤64 fields per schema/request/grant. Labels and condition strings ≤256 UTF-16 units; scalar strings ≤4,096; returned section label ≤256. Effective projection and validated scalar result each ≤16 KiB compact UTF-8. Related rows have their own limits above. |
| Visible fan-out | First 32 statically eligible bindings per point in ASCII order, **before** predicates. Per Overview ≤4 section outlets and ≤4 contributed cards total; ≤4 contributed detail tabs, ≤12 items per menu, ≤16 leaves per sidebar group. |
| Scheduling | Two automatic section calls and one foreground selection lane per window. Reserve before I/O. Queue only current visible cards; a slow section cannot occupy the foreground lane. Mark slow at 1 s; cancel asynchronous demands at 5 s. Suppress new calls to a timed-out generation until it settles or is explicitly reloaded. |

Index bindings per point and edges per source. Materialize stable ordered snapshots on demand;
subscribe each visible surface to its own point, not the whole graph. No full graph subscription
outside an open inspector. An unrelated grant or sibling reload must not reset another card,
tab, focus or scroll. A terminal with no published point has **no** extension listener on its
output hot path. Even with offers installed, bytes, keystrokes, screen repaint, hover, tab
reorder and terminal resize are not permission checks, peer renders or read triggers.

Reserve the local result area, use `aria-busy`, and announce loading only after 200 ms; cancel
the announcement on settle/retirement. Never spin or wait over the owner page, its header or
the native menu. Background/hidden tabs do not run features, mount Bodies or fetch related data.

### Optional byte warming

Ship with speculation **off**. `warmOnPage` is a section-only hint on a local owner page.
Consider verified **bytes only** on delegated keyboard focus or ≥100 ms sustained pointer
intent; cancel on exit. No object/connection params, passing hover, drag, touch, view warming,
menu prefetch, owner data read, code evaluation or result. Skip if static authorization does
not suffice. Enforce limits before I/O at host and client; do not trust `Content-Length`.

Reserve at most two hints/window, 32 KiB each, one attempt per contributor lifetime, 750 ms
read deadline and 15 s retention. Drop hints on expiry, revoke or unload. Demand may use a
completed, pinned hint with no second read. Cancel unfinished warmth and use the normal demand
path immediately. Warming failure does not fail a binding.

### Release measurements

Compare feature-off, absent, installed-but-denied, cold first use, resident code, and optional
warm hints. Pair foreground runs on the same engine, device/load, viewport, owner/resource
incarnation and authorized data. Alternate order; report cache state and ≥30 usable observations
per reported percentile. A hidden WebView is not a frame sample; an animation callback is
not physical paint. Never use PR wall-clock assertions.

| Measure separately | Proposed small-local-fixture gate |
|---|---|
| Owner's authorized content ready vs feature-off | p95 regression ≤5 ms; heading alone is not ready. Owner remains usable beside a slow/failing peer. |
| Tree/menu/strip labels, including terminal menus under output | p95 commit ≤16 ms. Zero extension evaluations, invocations and related reads. No extension-attributable >50 ms main-thread task. |
| Scalar result or selected Body shell | Selection → actual local commit p95 ≤50 ms resident, ≤250 ms cold. Break out code load, evaluation, render and data fetch, not one “ready” total. |
| Sidebar route and history | Compare exact same owner mount via internal destination and leaf; p95 route-dispatch overhead ≤5 ms. Record push, Back/Forward, scope, selection and visible Body separately. Never compare with launch of the peer's home. |
| Topology and terminal responsiveness | Report authorized read → validated rows → accessible graph/list commit; record rows/bytes/bounds, timeout and cancellation. Pair terminal typing/output and frame cadence with extensions off. p95 foreground frame gap at most one refresh interval above control. |

Count native asset reads (including schemes absent from Resource Timing), evaluations, calls,
Body mounts/unmounts, broker reads and refused/stale publications separately. Require zero
leaked data, stale paints, extra history commits and displaced focus. A metadata-only action
or inactive peer must not read/evaluate its feature or view asset; optional section byte hints
are a separately measured variant. Failure holds rollout or warming, not a reason to relax
the gate after measuring.

## Inspection and recovery

- **Discovery:** the metadata catalogue includes unopened pages and empty points; distinguish
  declared, mounted, eligible and selected. Show qualified point/offer IDs, provenance, version,
  placement/kind, protocol major, declared field/row types, import locator and supported action.
  Differentiate refused sources, parked/disabled bindings, collisions, over-budget entries and
  demand failures. Inspection must not run owner hooks or predicates, fetch objects, import
  code or select anything. Outline actual mounts only; no markers or focus stops in normal mode.
- **Access:** use the host **Show/Hide extension points** command (default `Mod+Shift+E`,
  rebindable/disableable). Start off per window. Ignore repeats, composition and competing
  modals; announce toggles and restore focus when an inspector control disappears. Inspection
  cannot alter owner/card identity.
- **Diagnostics:** bounded counts and spans for admission, eligibility, hint, queue, each
  asset load/evaluation, projection, render/read, stale/abort, timeout and recovery. Attribute
  by qualified point/offer, generation and stage. Keep latest per binding plus at most 128
  deduplicated recent Problems/window. Expected absence/cancellation/nonmatch are not failures.
  No raw errors/stacks, field values, predicate literals, terminal metadata/output, read
  evidence/rows, locators, scope keys, credentials or per-object match traces in diagnostics.
- **Operator recovery:** persist host-owned disables for one binding or one qualified offer
  across targets. Deny beats allow. Apply across windows and fence pending work. A profile-wide
  kill switch plus a startup override (`OMNIVIEW_DISABLE_UI_EXTENSIONS=1`, proposed) bypass
  extension activation even with an unusable renderer. No imports, mounts, reads, hints or
  dispatch. Keep ordinary pages, native menus, Back and operator controls. Restart under the
  override for a clean JS realm. Re-enable only explicitly, with current policy/pins.

## Release conformance

These are **tests to build after approval**, not results. Use independent packed artifacts,
a disposable profile and the existing unit/seam/native tracks. Each negative control must
fail its named assertion rather than dying earlier on an unrelated import.

| Exercise | What must hold |
|---|---|
| A pre-existing Kubernetes history and a second Kong workspace tab | Press Kong Admin. Original tab ID/count unchanged; new leaf current, Kubernetes rail/tree/picker intact, main region shows nominated Body. Back restores precisely the prior resource and its state; Forward remounts under fresh authority. Other tab and history untouched. |
| Repeat, branch, confirm, explicit dispositions | Repress current leaf: no duplicate. Back then another leaf: only forward branch dropped. Cancel unsaved prompt: no change. Background/new/window follow the gesture table; an unavailable window cannot consume the source. |
| Open link/restore/Back with denied, absent, reloaded or forged binding | Preserve well-formed history entries and neutral unavailability. No peer/home route, default cluster, stale face, read or old Body. Malformed/extra/duplicate address members cause no navigation. Verify foreground and background restore separately. |
| Deployment detail and Service Topology | Match a generic granted fact and show two independent eligible views after owner tabs. Selecting one changes neither resource nor shell history; tablist and panel names agree. Denied/optional-missing attribute or removal while selected causes no stale render, focus loss or re-selection. |
| Related read, permission change and same-name replacement | Check both directions against independently authorized evidence; test complete-empty, partial, truncated, denied, slow and failed reads. Forge a root/citation, change subject/connection/UID or revoke mid-read: no stale/private rows or counts. Missing read grant never calls the backend. |
| Two same-labelled Pod sessions; B right-clicked with A active | Each menu uses B's live origin, including when A's document shows another cluster. Verify separate header/body grants, native items first, mouse reporting and keyboard/Escape. Listing makes no contributor call and reads no terminal data **for an offer**. Close, reopen, take over or reattach B while menu open; stale click cannot operate on A, B or a replacement. |
| Native fallback and menu destination | Local shell, restored/held session without proof, stale attributes or ungranted fields: native actions only. Select one `info`, then another: only current result is announced. `openView` cannot smuggle a URL, foreign page, wrong object, denied destination, command, clipboard operation or terminal access. |
| Admission, ordering and consent | Page-only and route-less packages work. Reverse install/grant order, reuse a protocol at two points, duplicate labels and collide with an owner key. Bad pins/shape, surplus export, incompatible major or policy race never publish; the healthy sibling retains its DOM, focus and subscription. |
| Reentrancy, stale work and failure | Use getters/proxies, wrong types and oversized results; never inspect denied fields or raw throws. Delay success **and failure** past A → B → A, hide, revoke/regrant, unload or window teardown. Shared import may finish for another live mount but cannot resurrect the retired one. |
| Budgets, inspection, kill switch | Exercise N and N+1, read and code timeouts, hint expiry, noisy terminal output and cold catalogue. Disable one binding, then all. No hidden work, duplicate activation or owner displacement; blocked code cannot overwrite healthy output. Run the paired native measures above. |

**Prior evidence, not conformance.** The experimental catalogue, private policy file, scalar
cards, text tab and Overview action demonstrated independent grants, a shared module evaluation
and useful local containment. The prior sidebar test exercised a different location. Neither
the `generation: 2` lab manifest, its version-based feature URL nor a watched grant file is
the proposed ABI. The [brief](../status/KL-rest.md) records the sample sizes and limits. Rich
Bodies, terminal provenance, backend-verified relationships, owner-scoped history, cold
activation and rollback all still need a production proof.

**Outside v1:** state-changing commands, arbitrary component placement, shell/frame takeover,
unbounded queries, generic cross-plugin services, terminal automation, table cells/columns,
editors/settings and automatic fallback providers. An additional peer on a published compatible
point needs no host update; a new native surface or privileged operation requires a separately
reviewed host capability.
