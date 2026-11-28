# Four places a plugin can contribute

**Design for review, not a shipped SDK.** The rule is simple: the owner chooses **where**, the contributor supplies **what**, and the host decides **whether**. Selecting an extension does not transfer ownership of the workspace or grant access to another plugin's backend.

| User action | What should change | What must stay |
|---|---|---|
| Right-click inside a managed Pod terminal | An applicable item appears in **Terminal actions**. | The terminal, its native commands and its input ownership. |
| Choose **Kong workload** on a Deployment | A contributor-authored panel opens below the detail tabs. | The Deployment, header, breadcrumb, cluster and workspace tab. |
| Choose **Extensions → Kong Admin** in Kubernetes | The main area shows the contributor's admin view. | Kubernetes rail, resource tree, cluster scope and this tab's Back/Forward history. |
| Choose **Topology** on a Service | Two lists show which objects refer to this Service and which neighbors it targets. | The Service detail page. Neither list is a claim about live network traffic. |

Within an already published point, another peer can add a view, label or condition without a host or owner release. A new fact or read operation needs its owner's versioned contract. A genuinely new physical surface needs its owner to place an outlet there once. The host never needs a list of Kubernetes kinds, manager names or Service relationships.

## 1. A Pod terminal menu is not a Pod Overview menu

**Where:** Start with a secondary click **inside the terminal screen**, not on its session tab or the Pod header. The host already builds this menu in [`terminalMenu.ts`](../../../ui-next/shell/panel/terminal/menu/terminalMenu.ts). Its [trigger](../../../ui-next/shell/panel/terminal/menu/useTerminalMenu.ts) also handles Shift+F10, the Menu key and Shift+secondary-click when a terminal application captures the mouse.

**Who supplies context:** The host owns the shell, menu, focus and session lifetime. Kubernetes owns the resource that started a Kubernetes session. The proposed `contributionV1.panel.sessions.terminal.useMenuOutlet(origin)` lets **that owner only** return `{extensionScopeKey, outlet: menuOutlet(point, context)}` or nothing. `origin.surface` distinguishes `terminal-body` from `session-tab`; exposing the strip menu also would require a distinct point and grant. No contributor installs a global right-click handler.

- Bind the invoking session to its verified producer, `origin.connection`, resource incarnation and selected container, if applicable. `origin.route` carries only the owner's local page and parameters. Compare the authorized record to the session origin, never to the foreground page, displayed title, command line or card's link. Two sessions called `app` can belong to different Pods.
- Kubernetes can publish `kind` and the optional `managedBy` fact from the **Pod's own** `extensions.omniview.dev/managed-by` label. The peer requests them and declares its condition. Do not send the label map, terminal ID, xterm, session handle, selection, bytes, environment, command history, clipboard or credentials.
- Append eligible entries as a separate group after built-in items. Right-click, keyboard-open, arrowing and Escape execute no peer code. Choosing **Show management source** runs one `info` offer for display text. Choosing **Open manager** instead uses `openView`: the host rechecks an independently granted view binding for the same owner and valid scope. Neither action writes to stdin, pastes, attaches, runs a process or mutates a resource.
- If ownership, container, grant, session or incarnation changes before selection, dismiss the obsolete menu. Return focus to the invoking terminal if it still exists. A local terminal running `kubectl`, an unverified restored session, or a taken-over session with no valid resource lease gets **only built-ins**.

### What “based on attributes” means

This is peer **eligibility**, not the Kubernetes label selector used later to find Pods. A target may have one `when` array: 1–4 distinct, typed equality tests joined by **AND**. Omitting `when` makes a target unconditional, not automatically granted.

```ts
when: [
  { field: 'kind', equals: 'Pod' },
  { field: 'managedBy', equals: 'kong-lab' },
]
```

Both fields must be declared, requested, granted and present on this mount. Validate permission for **all** condition keys before reading any value. `kind: 'Deployment'`, a missing/denied `managedBy`, or a different value means **no item**, not a disabled item that reveals a match. Numeric `0` is not the string `'0'`. No fifth term, repeated key, OR, regex, label-path traversal or JavaScript predicate. A peer can target `managedBy: 'other-manager'` without an owner change. It cannot search private annotations; the owner would first need to publish a suitable fact.

**Today's gap:** Kubernetes has backend Pod exec in `pkg/plugin/exec/register.go`, but the lab UI's `ui/src/pod/overview/commands.ts` disables **Shell**. The host's [`PanelHostV1`](../../../ui-next/plugins/contract/v1.ts) exposes logs and optional ports, not a public terminal launch. [`TerminalTarget.resource`](../../../ui-next/shell/panel/terminal/feed.ts) is presentation data, not a resource attestation. A real plugin-session launch path with proven origin is a prerequisite for this case. A screenshot of the Overview menu or a renamed local shell does not satisfy it.

## 2. Another tab on a Deployment

**What the owner changes once:** Publish a `view` point with `placement: 'detail-tab'` and place `tabOutlet(point, context)` on the ready **`DetailView` itself**. Keep `extensionScopeKey` bound to the actual object incarnation. Do not bury the strip inside an Overview card. Match the returned record's kind, namespace, name and connection to the resource the user opened. A retained preview, fallback connection or failed read cannot establish this mount.

**What two independent peers can do:** On a Deployment-only point, **Replica summary** needs no `when`; it can use individually granted replica facts. **Kong workload** requires `managedBy == 'kong-lab'`. Declare `optional: ['managedBy']` in the point's protocol: omitting the label must suppress only the conditional tab, not the outlet or an unconditional peer. Do not use a fake empty string or infer the Deployment's manager from `spec.template.metadata.labels`. A shared workload point can instead test both `kind == 'Deployment'` and `managedBy == 'kong-lab'`.

**On selection:** The host appends contributed headings after owner headings and keeps the [existing labelled tab strip and panel](../../../packages/kit/src/components/Tabs/Tabs.tsx). Listing labels does not import a Body. Click or a kit arrow key that **selects** the tab mounts the contributor's named kit Body; bare hover/focus does not. The Body may draw cards, a table or a local filter from its allowed props. It receives neither `ContextV1` nor a Deployment client. This is an **in-page** choice: no new workspace tab or history entry. A withdrawn offer falls back to the last valid owner tab, usually Overview; an exception belongs to its panel, not the resource header.

**Today's boundary:** In the lab, `ui/src/kinds/detail/page.ts` declares only Overview. `deployments/detail.ts`, `detail/useKindDetailPage.ts` and `workloadExtensions.ts` project a verified, labelled Deployment. Native evidence covers a conditional **text** tab for `gateway-sample` and its absence for `other-sample` and `plain-sample`. It does not prove a kit Body, an unconditional tab on an unlabelled Deployment, or related-data access. A Deployment → ReplicaSet resolver already checks the Deployment UID; that does not entitle any tab to list ReplicaSets or read referenced Secrets.

## 3. A sidebar choice stays in Kubernetes

```text
Same workspace tab throughout:
Services list → Service details → Extensions / Kong Admin
                ← Back            ← Back
Forward from the list returns to Service details, then Kong Admin.
```

The lab's `sidebarNavigation.ts` explicitly constructs a route with `plugin: peer.id`; the lab peer declares both `home` and `landing` as `admin`. That explains the switch of plugin in the reported behavior. A screenshot of the peer's admin heading, or a fast navigation time, is not proof of correct history.

**Proposed:** Kubernetes publishes a sidebar view point. The peer binds a **named view Body**, not a custom page, default route or landing. On an ordinary press, the host pushes an **owner-hosted mounted view** onto the current tab's history, preserving its ID, earlier entries and page state. The tree still identifies **Extensions / Kong Admin** in Kubernetes; the host retains the cluster scope without passing the peer a connection handle. The peer can also have its own standalone page; that page is not the destination here.

Back restores the preceding Kubernetes page and its saved state. Forward opens the same binding after fresh checks. A repeated press at the same destination does not add a duplicate history entry. An explicitly requested new-tab disposition is separate. If the binding disappears, its history entry must not redirect to a peer landing, silently select a default cluster or clear the history. Show a host-owned unavailable state with a working Back path. See the [runtime reference](extension-runtime-v1.md) for exact navigation and restore policy.

## 4. Service Topology: the rich view and the read are separate

For the screenshot's `default/kubernetes`, the Service's metadata labels are **not** its selector. The captured Service has **no `spec.selector`**. The matching captured EndpointSlice is also named `kubernetes`; it lists `172.18.0.2` without a Pod `targetRef`. An authorized display of those captures would look like this:

```text
Topology · default/kubernetes

Points here                         This Service points to
EndpointSlice/default/kubernetes    Endpoint address 172.18.0.2
  publishes endpoints for it          listed by the associated EndpointSlice
```

Those are fixture facts, not a hard-coded special case, a live cluster query, or a claim that the API server is a Pod. An Ingress would appear on the left **only** if a readable Ingress actually referenced this Service. Ports, health and client traffic are not inferred from these two rows.

### What each author ships

**Kubernetes owns the point, read vocabulary and native provider.** These proposed declarations belong in its published contract. Empty `fields` suffices here: the owner already titles the page, and the peer need not receive the Service UID, route or connection to draw neighbors.

```ts
export const serviceNeighbors = defineRead('kubernetes/service-neighbors@1', {
  row: {
    direction: 'string', relation: 'string', kind: 'string',
    namespace: 'string', name: 'string', evidence: 'string',
  },
});

const serviceView = defineProtocol('kubernetes/service-view@1', {
  kind: 'view',
  fields: {},
  read: serviceNeighbors,
});

export const serviceTabs = definePoint('kubernetes', 'service-tabs', serviceView, {
  placement: 'detail-tab',
  label: 'Service detail tabs',
});
```

On an authorized, ready Service, Kubernetes places `tabOutlet(serviceTabs, {})`. It supplies `DetailView.extensionScopeKey` and the proposed owner-only `DetailView.extensionRoot = extensionRootOf(record)`. The latter comes from the *actual host-issued record*, not a clone, route string, Kubernetes UID or object authored by the peer. A scope key fences stale views; only the host's private attestation can bind a backend read.

**The external author owns only the offer and Body.** It imports `serviceTabs` from the owner's documented package/export. It needs no installed Kubernetes source code, display-mode switch, route or fake plugin home.

```ts
export const topology = defineViewOffer(serviceTabs.protocol, {
  label: 'Topology',
  targets: [serviceTabs],
  requests: [],
  requestRead: true,
});
```

The peer lists `topology` in its offers and exports a Body under that key from `views.tsx`. `ViewProps<typeof topology>` supplies `input` and `related`. Use the kit's two labelled `SectionCard`s with `ListRows` or `DataTable`: split rows by `direction`, show the relation beside each name, and preserve a text alternative if a diagram is added. A row is display data, **not** a link, action or permission token. Kubernetes could instead build this as its own detail tab with the same provider semantics. No extension is needed to draw first-party UI.

### What the provider means by “neighbor”

`kubernetes/service-neighbors@1` is a one-hop, read-only snapshot around **this Service in its namespace and connection**. The broker takes no query from the Body. Each row has the six strings above. `namespace` is the evidence scope, not a namespace assigned to an IP address. `name` is the neighbor's display name or literal address. The remaining fields follow this closed vocabulary:

| Direction | `relation` · `kind` · `evidence` | Include only when… |
|---|---|---|
| `inbound` | `routes-to` · `Ingress` · `ingress-backend` | A same-namespace `networking.k8s.io/v1` Ingress names this Service in `spec.defaultBackend.service` or a rule's `http.paths[].backend.service`. Ignore resource backends. This is a declared route, not traffic. |
| `inbound` | `publishes-for` · `EndpointSlice` · `slice-service-name` | A same-namespace `discovery.k8s.io/v1` slice has `kubernetes.io/service-name` equal to this Service's name. If a Service owner reference is present, its identity must agree with the current Service UID. A labelled manual slice need not have an owner reference. |
| `outbound` | `selects` · `Pod` · `service-selector` | A **nonempty** Service `spec.selector` matches **all** pairs on the actual Pod's labels in the same namespace. Absent or `{}` selects no Pods. `clusterIP: None` means headless, not selectorless. Selection does not imply endpoint membership or readiness. |
| `outbound` | `has-endpoint` · `Pod` · `slice-target` | An associated slice has a same-namespace Pod `targetRef` whose identity, including UID, matches a readable Pod. This is membership reported by the slice, not observed traffic. |
| `outbound` | `has-endpoint` · `EndpointAddress` · `slice-address` | A readable slice endpoint has an address and **no** `targetRef`. Show the authorized IPv4, IPv6 or FQDN literal. Never resolve DNS or guess a Pod from its IP. An inaccessible or stale reference is not a license to show its address instead. |
| `outbound` | `aliases` · `DNSName` · `external-name` | For `ExternalName`, `spec.externalName` supplies the DNS alias destination as text. Do not contact the name or treat it as a Pod or ordinary Service forwarding target. |

Keep selection and endpoint membership as distinct relations even for the same Pod. Deduplicate duplicate evidence for the same edge (repeated Ingress paths, overlapping slices); do not double-count mirrored legacy Endpoints. `@1` does **not** enumerate every caller, follow Pod owners to Deployments, infer clients from DNS strings, or traverse external/cross-namespace Gateway routes. Those need documented evidence and authority of their own. “No known incoming reference in supported sources” is meaningful; “nothing uses this Service” is not.

### How a read stays inside its authority and budget

1. **Selection creates demand.** An active view binding permits a Body, not a read. Require the exact requested operation, separate consent bound to both artifact pins and row contract, an authorized current owner root, subject/session and connection. No read on catalogue inspection, hover, inactive tab or label listing. If the native broker cannot establish that authority, do not dispatch.
2. **Dispatch to the owner's native `ReadRelatedV1`, not contributor JavaScript.** The broker fixes the operation ID, root reference/incarnation and live connection from the admitted mount. Use the caller's Kubernetes permissions and the host's resource boundary; do not substitute an elevated account. Authorize source collections, the returned neighbor **and the evidence that proves the edge**. Carry canonical proof privately for each candidate, e.g. Service + EndpointSlice + Pod. For an address-only row the proof is the readable address field on that slice. The peer gets none of the proofs. No general `get`, `list`, graph handle, GVR, selector, cursor or credential enters `ViewProps`.
3. **Bound the work, not just the DOM.** Use bounded authorized indexes/namespace queries. Pod labels and the slice service-name label can narrow a Kubernetes list; Ingress backend names need a bounded reverse index or paged namespace read, not a global scan. Proposed acquisition ceiling for this provider: 8 pages/lookups, ≤64 objects per page, ≤2 MiB of decoded input in total, within the 5 s demand deadline. Stop before exceeding a ceiling; never turn a limit into an unbounded list or one uncapped lookup per row. These are proposed provider limits, not measured budgets.
4. **Return one validated page.** At most **128 rows total** across both directions and **64 KiB compact UTF-8**; no nested objects, raw manifests, URLs to execute, cursor, follow-up watch or automatic polling. Deduplicate, order deterministically by the documented row fields, and stop at a complete row. The honest provider signals a cut; the broker rejects malformed, over-budget or unauthenticated responses before they reach the Body. Recheck authorization at delivery, including on a cache hit. Never share an answer across grants, subjects, roots or connections.
5. **Cancel across the boundary.** Changing tab, Service/UID, connection, subject, policy or installed generation retires this read. Propagate cancellation to native demand, Kubernetes calls and any held interest; release on completion or timeout. Discard late successes **and** failures even if the provider ignores abort. A new visit starts a new lease. Never display a former Service's topology while the next one loads.

| `related` supplied to the Body | What the user may conclude |
|---|---|
| `unavailable` | No authorized read is available (for example, view consent but no operation consent). No lookup. Do not imply zero neighbors. |
| `loading` / `failed` | Show a local pending state or safe failure, never cached edges from an earlier authority. Owner tabs remain usable. |
| `ready`, `coverage: 'complete'`, `truncated: false` | Within the declared sources and scope only, an empty direction means no matching edge was found. |
| `ready`, `coverage: 'partial'` or `truncated: true` | Show proven rows and a coverage notice. Partial means some supported evidence could not be examined. Truncated means known **authorized** rows exceeded the display budget; it is not a count of hidden neighbors. |

A denied root yields no rows. A source family that cannot be authorized must not reveal whether any such object exists. If other families can be proven independently, report generic partial coverage independent of denied object counts; otherwise withhold the result. Never turn a graph error, unsupported API, failed page, missing grant or deadline into a green “no dependencies.”

**Consent copy matters here.** An empty scalar request does not make this read anonymous: the full row contract can disclose Pod names and internal IP/DNS addresses. Name that disclosure when granting `service-neighbors@1`; deny the operation if it is too broad. The Kubernetes provider establishes an edge's meaning; the native broker admits its private citations under the current subject. The design narrows this API between trusted plugins. It does not sandbox arbitrary code in the shared JavaScript realm.

## What the code already supports, and what still needs proof

- **Kubernetes checkout:** `extension-lab-kubernetes/ui/src/kinds/services/detail.ts` explicitly leaves endpoint status out of the single-object overview. `pkg/plugin/resource/resourcers/relationships.go` declares Service → Pod via `spec.selector`. Its Ingress entries target Secrets and IngressClasses, **not** Service backends. Existing `GetRelated` cannot invent the missing Ingress and EndpointSlice joins; Kubernetes must supply them for this contract.
- **Host checkout:** [`GraphService.GetRelated`](../../../backend/pkg/plugin/resource/graph_service.go) already admits the source and cited nodes. Its [`QueryRelated`](../../../backend/pkg/plugin/resource/graph/queries.go) supports both directions and limits. These are implementation ingredients under the owner/broker, not APIs to pass to a peer. [Graph demand](../../../backend/pkg/plugin/resource/graph_demand.go) can signal missing provider-only relations as truncation, so do not translate that bit blindly into “more authorized rows.”
- **Recorded observations:** Kubernetes `ui/src/kinds/services/fixtures/services-detail.json` and `ui/src/kinds/endpointslices/fixtures/endpointslices-table.json` contain the selectorless API Service and its address. The lab host's `ui-next/plugins/host/{DetailTabOutlet,OverviewOutlets}.tsx` and `sidebarNavigation.ts` implement text, Overview-only actions and a **foreign** page respectively. The [recorded native run](../status/KL-rest.md) covers those older behaviors, not the replacements below.

### Acceptance: run these as future gates, not claims of verification

| Case | Set it up | Require this observation |
|---|---|---|
| Terminal provenance | Same-titled sessions for a matching Pod, an unlabelled Pod and a local shell. Change foreground page. | Only the intended terminal has the item. The strip does not inherit a body-only point. |
| Menu dispatch | Deny a predicate field, change container, take over the session, or press an obsolete item. | Zero peer calls. Keyboard dismissal and the emulator's mouse-reporting/Shift override still work. Valid selection performs no terminal read/write, attach, clipboard or process call. |
| Deployment strip | Install the two peers in reverse order. Try an unlabelled Deployment, a matching one and one with the label only on its Pod template. | The unconditional tab survives all three. Only the second gets the managed tab. Keyboard selection loads one Body; withdrawing it preserves the owner header, focus and history. |
| Matching grammar | Compile a fifth term, repeated key or wrong literal type. At runtime withhold one condition field even though the object matches. | Refuse invalid metadata. A denied field is not read; no label, disabled item or invocation reveals a match. |
| Sidebar history | Leave a peer page open elsewhere. In Kubernetes go list → detail → Kong Admin, Back twice, Forward twice. | Same tab ID, owner tree, selection and cluster. Back then a different press changes only the normal forward branch. Revocation before Forward never takes the user to a peer home or fallback cluster. |
| Two directions | Seed a default Ingress backend and path backend, two-label Service, fully/partly matching Pods and EndpointSlices. | Compare every displayed edge to authorized API objects, not just counts. Ignore same-name foreign namespaces/clusters, deduplicate paths/slices and never turn a selector match into health. |
| Selectorless | Compare captured `default/kubernetes` and `network/no-selector` (manual FQDN and mirrored IPv4 slices). Add an old-owner UID control. | Zero `selects` rows; actual slice/address rows when allowed. Exclude the stale slice. Use an isolated namespace for seeded resources, never edit the cluster's API Service. |
| Other Service types | Use a headless Service with a selector; use an `ExternalName` Service. | The former can select Pods. The latter shows the literal alias without DNS/network access. |
| Read authorization | Grant the view but deny its read. Deny a required source or row citation. Replay a proof on another cluster with identical names/UIDs. | No dispatch without the operation grant. No unauthorized row, address, hidden count or usable replay. A denial is never rendered as known empty. |
| Bounded answers | Test 128/129 authorized rows; exactly 64 KiB and one byte over. Exhaust the acquisition budget before coverage is complete. | A valid limited page reports truncation; a malformed/oversized response fails. Incomplete acquisition yields partial, not “none.” Check partial, truncated, failed and complete-empty separately. |
| Cancellation | Hold a read across A → B → A, hide, reload, revoke and deadline. Return old success and failure out of order. | The provider sees cancellation, native interests are released and no stale state reaches the panel. The owner remains usable. |

The [SDK/wire reference](extension-api-v1.md) defines the public contract; the [runtime reference](extension-runtime-v1.md) defines host gates. None of these scenarios needs a new privileged command or an arbitrary cross-plugin read.