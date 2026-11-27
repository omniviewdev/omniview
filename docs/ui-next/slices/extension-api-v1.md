# Plugin UI extensions v1: author API and wire contract

**Approved production contract; not released.** The first implementation gate covers the author SDK, manifest decoder and Vite packager. A successful build does not enable a binding or authorize a read. See the [owner brief](../status/KL-rest.md) for delivery gates, the [worked scenarios](extension-view-scenarios.md) for Kubernetes semantics and the [runtime reference](extension-runtime-v1.md) for host obligations.

## Choose a placement

| What the user sees | Who supplies it | What selection does |
|---|---|---|
| A fact in Overview | Owner places a `section` point; contributor supplies a scalar feature. | A visible, eligible card requests one label/value pair. |
| A Deployment tab or a Service **Topology** tab | Owner places a `view` point on the detail tab strip; contributor supplies a kit Body. | Mounts that Body **inside the current resource page**. An authorized related read can supply data. |
| An item in a Pod terminal context menu | Session owner places a `menu` point on a specific terminal surface; contributor declares an action. | Shows read-only information or asks the host to open an independently eligible mounted view. |
| **Extensions → Kong Admin Manager** | Kubernetes places a `view` point in its ordinary sidebar; Kong supplies its named Body. | Pushes one **Kubernetes-hosted** location in the same workspace tab. Back returns to the previous location; Forward reopens the mount. |

A **point** is a place the owner publishes. An **outlet** places it in a live view. A contributor's **offer** names one piece of content; a **binding** targets one point with it. A **protocol** fixes the input, output and meaning. None of these is permission.

New bindings to a published point need **no host or owner release**. Owners can publish new points on supported surfaces without adding their domain vocabulary to the shell. A new physical control with no outlet adapter, a new backend operation, or a new kind of authority is not obtained by inventing a point ID.

### Who imports what

| Role | Source | Imports |
|---|---|---|
| Owner contract publisher | A small, independently packed npm package | Value builders from `@omniviewdev/runtime/ui/extensions/v1`. Export literal point references and their semantic documentation. |
| Owner page author | Ordinary `ui/src/entry.ts` and page hooks | Named owner point references; pure outlet builders from `/ui/extensions/v1`. Import `extensionRootOf` from the existing shared `@omniviewdev/runtime/ui/v1` **only in owner code**. |
| Contributor | `ui/src/extension.ts` | Point references from the **public package root** advertised in the catalogue, plus the descriptor builders. No owner page or backend import. |
| Feature author | `ui/src/features.ts` | Type-only offer contracts. Bundle any private pure helpers. No runtime externals. |
| View author | `ui/src/views.tsx` | Type-only `ViewProps` and descriptor; shared React and `@omniviewdev/kit` for drawing. No runtime data hooks. |
| Packager | Existing `ui/vite.config.ts` | `omniviewExtensionsV1()` from `@omniviewdev/vite-plugin`. Install and build in this plugin's own `ui/` project. |

`/ui/extensions/v1` above abbreviates `@omniviewdev/runtime/ui/extensions/v1`. It is a **pure build/library subpath**, not another shared singleton. Bundle value helpers used by an owner page. The existing [`contributionV1` and `assets/entry.js`](n19-plugin-seam.md) remain the ordinary page contract.

## Recipe 1 · Owner publishes the place, not the integration

These excerpts use an illustrative contract package, `@example/kubernetes-points@1.4.0`. Its root module exports the points below. These are authoring examples, not packages to install in production.

**A terminal menu.** Publish facts peers may match. Do not predict which managers will install.

```ts
import { definePoint, defineProtocol, defineRead } from '@omniviewdev/runtime/ui/extensions/v1';

const workload = {
  fields: { kind: 'string', managedBy: 'string' },
  optional: ['managedBy'],
} as const;

const terminalProtocol = defineProtocol('kubernetes/terminal-menu@1', {
  kind: 'menu',
  ...workload,
});

export const terminalActions = definePoint('kubernetes', 'terminal-actions', terminalProtocol, {
  label: 'Pod terminal tab actions',
  placement: 'context-menu',
});
```

**A detail tab and a sidebar mount.** Both accept rich views; they occupy different places. A sidebar Body needs neither a contributor page nor a fake landing.

```ts
const deploymentView = defineProtocol('kubernetes/deployment-view@1', {
  kind: 'view',
  ...workload,
});
export const deploymentTabs = definePoint('kubernetes', 'deployment-tabs', deploymentView, {
  label: 'Deployment detail tabs', placement: 'detail-tab',
});

const sidebarView = defineProtocol('kubernetes/sidebar-view@1', {
  kind: 'view', fields: {},
});
export const sidebarTools = definePoint('kubernetes', 'sidebar-tools', sidebarView, {
  label: 'Extensions', placement: 'sidebar',
});
```

**An optional related read.** Zero scalar inputs are enough for Service Topology. The selected Service is the *root of a native read*, not a resource object or ID that the contributor gets to query.

```ts
export const serviceNeighbors = defineRead('kubernetes/service-neighbors@1', {
  row: {
    direction: 'string', relation: 'string', kind: 'string',
    namespace: 'string', name: 'string', evidence: 'string',
  },
});

const serviceView = defineProtocol('kubernetes/service-view@1', {
  kind: 'view', fields: {}, read: serviceNeighbors,
});
export const serviceTabs = definePoint('kubernetes', 'service-tabs', serviceView, {
  label: 'Service detail tabs', placement: 'detail-tab',
});
```

**Advertise the exact exports.** The plugin descriptor imports named values from the published package root. The compiler obtains the catalogue's package, version and export from this import, not by guessing from `kubernetes/service-tabs`.

```ts
// Owner: ui/src/extension.ts
import { definePlugin } from '@omniviewdev/runtime/ui/extensions/v1';
import {
  deploymentTabs, serviceTabs, sidebarTools, terminalActions,
} from '@example/kubernetes-points';

export default definePlugin({
  id: 'kubernetes',
  points: [deploymentTabs, serviceTabs, sidebarTools, terminalActions],
});
```

## Recipe 2 · Owner places a live outlet

The owner's [ordinary detail contract](../../../ui-next/page/detailDefinition.ts) already distinguishes `DetailSource.state`, `DetailView`, and each tab's `DetailTabContent`. It can retain a view after a failed refresh. A displayed old name is **not** a ready extension context.

| Ordinary owner contract | Where it applies |
|---|---|
| `DetailView.tabOutlet?:` return value of `tabOutlet(point, context)` | One strip on a **detail** page. Put it on `usePage(...).source.view`, not on a particular Overview tab's content. Owner tabs stay first. |
| `DetailTabContent.outlets?:` list of `outlet(point, context)`; `menuOutlet?:` result of `menuOutlet(point, context)` | Only the `kind: 'overview'` arm. Place facts or a read-only menu in that Overview. This menu is not a terminal menu. |
| `DetailView.extensionScopeKey?: string` | Owner-only object-incarnation key for object-scoped mounts. Nonempty, ≤256 UTF-16 units; stable for that incarnation, new on replacement. Not a route, permission, telemetry field or peer prop. |
| `DetailView.extensionRoot?: ExtensionRootV1` | Optional opaque native-root proof for a related read. Without it the Body may mount but receives no related data. |
| `contributionV1.sidebar.outlet?: string` | Local ID of one `view`/`sidebar` point on the ordinary owner's sidebar, not the plugin landing's connection picker. Must have empty `fields` and no `read`. |
| `contributionV1.panel.sessions.terminal.useMenuOutlet?(origin)` | For a resource-bound terminal, return `{extensionScopeKey, extensionRoot, outlet: menuOutlet(point, context)}` or `undefined`. The root must identify the same current record used to derive the menu facts. |

**Deployment.** After the authorized response matches the active page, connection and object, add these members to the owner's ready `DetailView`. `kind` comes from the verified resource; `managedBy` is one documented, optional fact, not the labels map.

```ts
import { tabOutlet } from '@omniviewdev/runtime/ui/extensions/v1';
import { deploymentTabs, serviceTabs } from '@example/kubernetes-points';

const deploymentPlacement = {
  extensionScopeKey: uid,
  tabOutlet: tabOutlet(deploymentTabs, {
    kind,
    ...(managedBy === undefined ? {} : { managedBy }),
  }),
};
```

No opt-in label? Omit `managedBy`, **not the whole outlet**. The unconditional Deployment tab still works; a peer requiring a particular value does not match. Withhold *all* object mounts on loading, denied, not found, failed, retained, wrong-connection or wrong-incarnation data.

**Service.** A native-root proof and a scalar projection do different jobs.

```ts
import { extensionRootOf } from '@omniviewdev/runtime/ui/v1';

const root = extensionRootOf(record);
const servicePlacement = {
  extensionScopeKey: uid,
  tabOutlet: tabOutlet(serviceTabs, {}),
  ...(root === undefined ? {} : { extensionRoot: root }),
};
```

The [curated runtime entry](../../../packages/omniviewdev-runtime/src/ui/v1.ts) exports `extensionRootOf(record: HostRecord): ExtensionRootV1 | undefined`. Pass the original record from the current native collection view. A clone, retained record, unsupported source or matching UID string is not a witness. Native admission checks the witness again at dispatch and delivery. Neither the witness nor `extensionScopeKey` belongs in peer props, a URL, history or diagnostics.

**Sidebar.** Add `outlet: sidebarTools.id` to the owner's existing `contributionV1.sidebar`. The host appends eligible rows. Activating **Kong Admin Manager** changes the main area, **not** the workspace owner. Keep the Kubernetes rail, tree, scope lane, selected connection and history. A display connection in the owner chrome is not a Kong connection, credential or Body prop.

**Terminal.** The [session-tab strip](../../../ui-next/shell/panel/SessionTabs.tsx) has its own hit-tested context menu. The [emulator surface](../../../ui-next/shell/panel/terminal/menu/useTerminalMenu.ts) has a different menu, including mouse-reporting and keyboard rules. The adapter receives only a verified owner-local resource origin:

```ts
// Input to the session owner's hook; never handed to an offer.
type TerminalMenuOriginV1 = {
  readonly surface: 'session-tab' | 'terminal-body';
  readonly route: Pick<RouteV1, 'page' | 'params'>; // original owner-local detail route
  readonly connection: string;        // explicit, verified origin connection
  readonly extensionScopeKey: string; // incarnation recorded at authorized launch
};
```

The host constructs `origin.route.params` without a `connection` member. The **only** connection is the verified `origin.connection`; reject a conflicting or ambiguous origin. Return the owner's point for the **hit surface and session**, after matching a fresh authorized record and launch incarnation. For the `terminalActions` example, return it for `session-tab` only. Exposing both surfaces deliberately uses distinct point IDs and grants, never automatic mirroring. The foreground page, terminal title, output, selection, commands and working directory are not provenance. The host compares the returned key to the live launch record again.

For example, the owner's hook can call this pure presenter. Pass `pod` only after the owner has a ready, authorized Pod record; its connection, UID, name and namespace come from that record.

```ts
import { menuOutlet } from '@omniviewdev/runtime/ui/extensions/v1';
import { extensionRootOf, type HostRecord } from '@omniviewdev/runtime/ui/v1';
import { terminalActions } from '@example/kubernetes-points';
import type { TerminalMenuOriginV1 } from './contract/v1';

type ReadyPod = {
  readonly record: HostRecord; // The live collection record from which all fields below were read.
  readonly kind: 'Pod'; readonly uid: string; readonly connection: string;
  readonly name: string; readonly namespace: string; readonly managedBy?: string;
};

function podTabMenu(origin: TerminalMenuOriginV1, pod: ReadyPod | undefined) {
  if (origin.surface !== 'session-tab' || origin.route.page !== 'pod' || pod === undefined ||
      pod.connection !== origin.connection || pod.uid !== origin.extensionScopeKey ||
      pod.name !== origin.route.params.name || pod.namespace !== origin.route.params.namespace) {
    return undefined;
  }

  const extensionRoot = extensionRootOf(pod.record);
  if (!extensionRoot) return undefined;

  return {
    extensionScopeKey: pod.uid,
    extensionRoot,
    outlet: menuOutlet(terminalActions, {
      kind: pod.kind,
      ...(pod.managedBy === undefined ? {} : { managedBy: pod.managedBy }),
    }),
  };
}
```

On a user action, the owner's connection-bound [panel handle](../../../ui-next/plugins/contract/v1.ts) can call `await ctx.panel?.terminal?.open({ record, route: { page, params }, params: selectors })`. Pass the original `HostRecord` from a live authorized collection, not a copy or a route-derived record. The locator names an owner detail page. Each producer selector must match the same parameter in that locator. No command, stream handle or session ID is accepted or returned.

The [native launch bridge](../../../ui-next/plugins/host/resourceShells.ts) verifies the record and binds the authenticated attachment to this window's actual feed. The owner-local locator and incarnation remain in memory, not in terminal labels, saved tab state or contributor props. A local shell, ended/detached session or unverified restore gets only the native menu. Opening, listing or dismissing a menu never loads contributor code.

## Recipe 3 · Contributor binds explicitly

These three excerpts form one descriptor. `requests` lists the most the contributor may receive. `targets` lists where it is willing to appear; neither is a grant.

```ts
// Contributor: ui/src/extension.ts
import { defineMenuOffer, definePlugin, defineViewOffer } from '@omniviewdev/runtime/ui/extensions/v1';
import {
  deploymentTabs, serviceTabs, sidebarTools, terminalActions,
} from '@example/kubernetes-points';

const admin = defineViewOffer(sidebarTools.protocol, {
  label: 'Kong Admin Manager', requests: [], targets: [sidebarTools],
});
const rollout = defineViewOffer(deploymentTabs.protocol, {
  label: 'Rollout', requests: ['kind'], targets: [deploymentTabs],
});
const topology = defineViewOffer(serviceTabs.protocol, {
  label: 'Topology', requests: [], targets: [serviceTabs], requestRead: true,
});
```

**Match attributes as data, not code.** This target matches a Pod **and** a manager value. Each comparison is on this binding's requested **and granted** fields. The host knows neither the label key used by Kubernetes nor the word `kong`.

```ts
const managedPod = {
  point: terminalActions,
  when: [
    { field: 'kind', equals: 'Pod' },
    { field: 'managedBy', equals: 'kong' },
  ],
} as const;

const menuOptions = {
  requests: ['kind', 'managedBy'],
  targets: [managedPod],
} as const;
```

**Choose exactly one menu action.** `info` selects an exported scalar feature. `openView` selects an independently bound view **from this contributor under the same owner**. A pointer to the view point alone is ambiguous when many peers target it.

```ts
const describePod = defineMenuOffer(terminalActions.protocol, {
  ...menuOptions, label: 'Show manager', action: { kind: 'info' },
});
const openAdmin = defineMenuOffer(terminalActions.protocol, {
  ...menuOptions, label: 'Open Kong Admin Manager',
  action: { kind: 'openView', point: sidebarTools, offer: 'admin' },
});

export default definePlugin({
  id: 'gateway-tools',
  offers: { admin, rollout, topology, describePod, openAdmin },
});
```

`openView` has **no handler**, input forwarding, URL, page, params, shell command, arbitrary React node or `onClick` from the contributor. Recheck both bindings and grants; derive destination context independently from its owner. For a detail destination, require its explicit point on the **same actual resource** identified by the menu origin. No origin, wrong object, incompatible point or revoked grant: no navigation. Do not guess a destination, inherit the menu's data, smart-open a foreign page or fall back to either plugin's home.

## Recipe 4 · Implement only the selected content

**Information feature.** The expected export name is the descriptor's local offer key. `input.managedBy` is optional even if the example condition used it. No feature receives a route, connection, session or terminal handle.

```ts
// ui/src/features.ts
import type { OfferInput, OfferResult } from '@omniviewdev/runtime/ui/extensions/v1';
import type plugin from './extension.js';

type Describe = typeof plugin.offers.describePod;

export function describePod(input: OfferInput<Describe>): OfferResult<Describe> {
  return { text: input.managedBy ?? 'Manager unavailable' };
}
```

Feature signature: `(input: OfferInput<O>, signal: AbortSignal) => OfferResult<O> | PromiseLike<OfferResult<O>>`. A synchronous one-argument function is valid. The host aborts obsolete work and discards late success **and** failure. Cancellation does not undo side effects; these are read-only features.

**View Bodies.** Author ordinary synchronous function components with `ViewProps<O>`. Use export aliases so component names follow React conventions and public names match the offer keys. No `CustomPageContextV1`, `setParams` or connection handle. Do not inherit the owner's kit `LinkProvider`: even an `href` resolved under it can disclose the owner's connection. Local presentation controls are fine; a Body cannot navigate as its host.

```tsx
// ui/src/views.tsx
import { ListRows, Stack, Text } from '@omniviewdev/kit';
import type { ViewProps } from '@omniviewdev/runtime/ui/extensions/v1';
import type plugin from './extension.js';

type Offers = typeof plugin.offers;

function AdminBody(_props: ViewProps<Offers['admin']>) {
  return <Text as="h2" variant="heading">Kong Admin Manager</Text>;
}

function RolloutBody({ input }: ViewProps<Offers['rollout']>) {
  return <Text as="p">{input.kind ?? 'Resource kind unavailable'}</Text>;
}
```

**Topology is not a text result.** A Body can compose kit tables, lists, local filters and sections. This small rendering uses the kit's actual [`ListRows`](../../../packages/kit/src/components/ListRows/ListRows.tsx). The read contract defines `inbound` as **neighbor → selected Service** and `outbound` as **selected Service → neighbor**. A visual diagram can accompany the readable edge list; no host-side Kubernetes diagram renderer is required.

```tsx
function TopologyBody({ related }: ViewProps<Offers['topology']>) {
  if (related.state !== 'ready') {
    const words = { loading: 'Reading relationships…', unavailable: 'Relationships unavailable', failed: 'Read failed' };
    return <Text as="p">{words[related.state]}</Text>;
  }

  const rows = related.rows.map(({ direction, relation, kind, namespace, name, evidence }) => ({
    id: JSON.stringify([direction, relation, kind, namespace, name, evidence]),
    title: direction === 'inbound' ? `${kind} ${name} → Service` : `Service → ${kind} ${name}`,
    detail: `${relation} · ${evidence} · ${namespace}`,
  }));

  return <Stack gap={8}>
    {related.coverage === 'partial' && <Text>Coverage is partial.</Text>}
    {related.truncated && <Text>More relationships exist within the authorized result.</Text>}
    {rows.length ? <ListRows label="Service relationships" rows={rows} /> : <Text>No visible relationships returned.</Text>}
  </Stack>;
}

export { AdminBody as admin, RolloutBody as rollout, TopologyBody as topology };
```

The selected Body owns only its bounded content area and local presentation state. The host owns focus handoff, tabs, menu, shell navigation, mount lifetime and per-binding failure UI. Use the host's React instance and kit; no portals into owner chrome, global styles/listeners, Wails, network calls, raw runtime APIs, externally actionable links or mutations through this surface. The host renders the selected function **as a component** under a local boundary; it does not call it as a feature or run each Body to find a label. Artifact validation and approved imports **do not sandbox malicious same-realm JavaScript**.

**Separate section recipe.** Existing scalar facts need no Body or backend read. `utilizationV1` (`visuals/utilization@1`) describes `used` and `capacity` of the same unit. Owners declare a `placement: 'overview-section'` point and mount `outlet(point, { used, capacity })`; peers use `defineOffer(point.protocol, { label, requests: ['used', 'capacity'], targets: [point] })`. A feature returns exactly `{label: string, value: string}`. A fraction is valid only with both fields, `capacity > 0` and `0 <= used <= capacity`. Zero used is 0%; missing or invalid capacity is **unavailable**. Optional section-only `warmOnPage` is a local owner page key permitting a bounded **bytes-only** hint, not early import, invocation or authorization.

## What the related-read capability means

The author can request **one fixed read declared by the view point**. There is no `read(plugin, query)`, callback on the Body, automatic object lookup from scalar input, or contract-defined arbitrary JSON. The Service owner can use the same domain operation in a built-in tab without installing an extension.

1. **Declare.** `defineRead(id, {row})` fixes a private owner operation and a closed nonempty scalar row schema. The private `view` protocol carries this reference; a peer writes `requestRead: true` or omits it. An offer that does not request the read never gets a `related` prop.
2. **Authorize separately.** A scalar grant does not authorize a read. A separate operator decision pins the exact point, offer, both artifacts, read ID/major and complete row schema. Consent covers that bounded row contract as a unit; it never scopes what the owner backend's authenticated user can read.
3. **Dispatch on selection.** The host validates both installation lifetimes, the selected view, the root witness and both grants. The native broker calls the installed **point owner's** fixed `ReadRelatedV1` operation. The contributor cannot choose the principal, connection, root, operation or query. The broker checks source and evidence permissions before disclosing a row. There is no UI `contributionV1.extensionReads` registry.
4. **Return one bounded snapshot.** Success is `{rows, coverage: 'complete' | 'partial', truncated: boolean}`. Each row has exactly the declared fields. Caps are 128 rows, 64 KiB total compact UTF-8 including the envelope, and five seconds; zero cursor, watch or automatic next-page request. Bound source work as well as delivery. `truncated` may describe only omitted **authorized** rows. No denied edge, count, hidden name or inference from a privileged cache. A partial scan is not proof of absence.
5. **Publish while current.** A requesting Body receives exactly `related: {state: 'unavailable' | 'loading' | 'failed'}` or `{state: 'ready', rows, coverage, truncated}`. No read grant/root/provider or denied scope means unavailable, never `ready: []`. Cancel on hide, change or revoke, fence late results, remove prior values, and never send a stale snapshot under the replacement object. The scalar-only Body and owner page remain usable if the read is unavailable.

The [Service scenario](extension-view-scenarios.md) defines honest edge evidence, selectorless behavior, provider budgets, partial coverage and negative cases. `ReadRelatedV1` and native root attestation are **new required infrastructure for this data path**, not existing resource hooks or a grant of Kubernetes credentials. A new provider operation needs owner/backend work, not a new shell widget. A full Kong management connection or write command likewise needs its own authorization; showing a mounted admin Body does not supply either.

## SDK reference · compile against this, not the examples' strings

Every `define*` returns **data**, preserving literal IDs, shapes, options and tuples. Preserve the inferred `const` type of a point's named export in its packed `.d.ts`; `: PointRef` erases what a consumer needs. No `register`, `unregister`, loader, registry handle, subscription or public route formatter.

### Call shapes

| Public value | Accepted arguments and returned value |
|---|---|
| `defineRead(id, {row})` | Private versioned ID and closed row map; returns `{id, row}` with literal types. |
| `defineProtocol(id, definition)` | Returns `{...definition, id, published: false}`. `section`: exactly `kind, fields, schema` with the fact schema. `menu`: `kind, fields`, optional `optional`. `view`: `kind, fields`, optional `optional, read`. |
| `utilizationV1` | Published, immutable `section`: `{used:'number', capacity:'number'}` → `{label:'string', value:'string'}`. No other published protocol in this proposal. |
| `definePoint(owner, id, protocol, options)` | Returns `{owner, id, protocol, ...options}`. Options require `label` and `placement`; only `section` permits `warmOnPage`. Kind/placement pairs are closed (below). |
| `outlet(point, context)`, `tabOutlet(point, context)`, `menuOutlet(point, context)` | Return exactly `{point: point.id, context}`. Require respectively `overview-section`, `detail-tab`, `context-menu` and that point's exact `PointContext`. Sidebar takes only its validated local point ID. |
| `defineOffer(protocol, options)` | `section` only. Options are `label, requests, targets`. Returns `{protocol, ...options}`. |
| `defineViewOffer(protocol, options)` | `view` only. Same three options, plus optional `requestRead: true` **only** if the protocol declares a read. Returns `{protocol, ...options}`. |
| `defineMenuOffer(protocol, options)` | `menu` only. Same three options, plus a required, closed `action`; returns `{protocol, ...options}`. `info` and `openView` cannot be combined. |
| `definePlugin({id, points?, offers?})` | Default export of `ui/src/extension.ts`; returns the same typed object. `points` are named values owned by `id`. `offers` is a closed record of built offers keyed by **local offer ID**. |

`Protocol` and `PointRef<P>` are public readonly reference types, not constructors. Other public type exports are `PointContext<T>`, `OfferInput<O>`, `OfferResult<O>` and `ViewProps<O>`. The `ReadPage` below names the shape in the notation; there is no runtime `ReadPage` helper.

### Projection and predicate typing

Owner context is exact; an offer's granted input is partial. For `workload` above:

| Type | What strict TypeScript must infer |
|---|---|
| `PointContext<typeof deploymentTabs>` | `{readonly kind: string; readonly managedBy?: string}`. `kind` is required; `managedBy: undefined` is not omission. |
| `OfferInput<typeof rollout>` | `{readonly kind?: string}`. It has no `managedBy`, UID or connection, even if other bindings request them. |
| `OfferResult<typeof describePod>` | `{readonly text: string}`. Available only for `section` and `menu`/`info`, never `view` or `openView`. |
| `ViewProps<typeof admin>` | `input` with no keys. No `related`, route, shell context or credentials. |
| `ViewProps<typeof topology>` | `input` with no keys **and** `related` with typed `direction, relation, kind, namespace, name, evidence` strings in the ready state. |

The following is type notation for the declarations. Each schema value is the **literal tag** `'string'` or `'number'`, never a sample value. The compiler rejects a widened string index signature in an actual declaration.

```ts
type Fields = Readonly<Record<string, 'string' | 'number'>>;
type Scalar<T> = T extends 'string' ? string : T extends 'number' ? number : never;
type Key<F extends Fields> = Extract<keyof F, string>;
type Values<F extends Fields> = { readonly [K in keyof F]: Scalar<F[K]> };
type Only<A, K extends PropertyKey> = A & Record<Exclude<keyof A, K>, never>;

type Context<F extends Fields, Opt extends keyof F> =
  Omit<Values<F>, Opt> & Partial<Pick<Values<F>, Opt>>;
type Input<F extends Fields, Requested extends keyof F> =
  Partial<Pick<Values<F>, Requested>>;
```

`PointContext<T>` uses `Context` with the point's `fields` and its `optional` tuple's element type (`never` by default). `OfferInput<O>` uses `Input` with **only** the literal `O['requests'][number]`. Strings and finite numbers only: no resources, nested objects, arrays, functions, `null`, credentials, URLs to execute or JSON tunneled inside strings. Snapshot granted own data properties; do not enumerate or invoke ungranted values. A missing *optional* field stays absent. A missing required effective field, accessor or present wrong type is invalid, not absence.

```ts
type Match<F extends Fields, K extends Key<F>> = {
  [N in K]: { readonly field: N; readonly equals: Scalar<F[N]> }
}[K];
type OneToFour<T> =
  | readonly [T] | readonly [T, T]
  | readonly [T, T, T] | readonly [T, T, T, T];
```

* `targets` is a nonempty readonly tuple. An entry is a plain point reference, or exactly `{point, when}` on `menu`/`detail-tab` targets. `when` is `OneToFour<Match<F, R>>`, where `R` is the **requested key union of this offer**. No condition on a section or sidebar.
* A condition is AND; each field appears once. Before examining any value, require **all** condition fields in the owner-declared ∩ requested ∩ granted set for this binding. Compare finite numbers or ≤256-unit strings with exact scalar equality; missing never matches. No coercion, truthiness, regex, label selectors, user predicates, disjunction or callbacks. `0` and `''` can be real values.
* A condition affects only this binding. A partial grant is sufficient **if it covers every comparison**; a missing comparison grant/value, unresolved policy or nonmatch yields no conditional row or code. Recheck on activation. An unconditional context-free view still needs an explicit grant; an empty list suffices.
* `defineProtocol`/`defineRead` preserve `const` map keys; `optional` contains distinct keys of `fields` only. Use `const` inference on `definePoint` and offers. Freeze inference from context/options/targets with `NoInfer<P>`; a typo cannot widen `P` or `requests`. Outlet declarations infer the actual argument `C extends PointContext<NoInfer<T>>` and require `Only<C, keyof PointContext<NoInfer<T>>>` — extra fields **on a variable** must fail a strict type check.
* Use the same exact-key discipline on builders, target wrappers, match entries and action unions. A private `section` schema is exactly the two fact tags. Only a `view` reference can be an `openView` destination. The binder additionally proves that the named local offer targets that exact owner point. Lexical bounds, duplicate names, resolved scope, cross-module references and exact emitted exports need packager/admission checks beyond structural TypeScript.

<details>
<summary>Representative declarations: exact outlet input and no predicate-driven widening</summary>

The remaining builders apply the corresponding kind/placement rules in the table above. The exact static decoder also checks the nested records and target tuples; TypeScript is not an install-time validator.

```ts
type ViewProtocol = Extract<Protocol, { readonly kind: 'view' }>;
type Tab<P extends ViewProtocol> = PointRef<P> & { readonly placement: 'detail-tab' };

export declare function tabOutlet<
  const T extends Tab<ViewProtocol>, const C extends PointContext<NoInfer<T>>,
>(point: T, context: Only<C, keyof PointContext<NoInfer<T>>>): {
  readonly point: T['id'];
  readonly context: Readonly<C>;
};
```

```ts
type ViewTarget<P extends ViewProtocol, K extends Key<P['fields']>> =
  | (PointRef<P> & { readonly point?: never; readonly when?: never })
  | { readonly point: Tab<P>; readonly when: OneToFour<Match<P['fields'], K>> };

type ViewOptions<P extends ViewProtocol, T = ViewTarget<P, Key<P['fields']>>> = {
  readonly label: string;
  readonly requests: readonly Key<P['fields']>[];
  readonly targets: readonly [T, ...T[]];
  readonly requestRead?: P extends { readonly read: { readonly row: Fields } } ? true : never;
};

export declare function defineViewOffer<
  const P extends ViewProtocol, const A extends ViewOptions<NoInfer<P>>,
>(protocol: P, options: Only<A, keyof ViewOptions<P>> & {
  readonly targets: readonly ViewTarget<NoInfer<P>, NoInfer<A['requests'][number]>>[];
}): A & { readonly protocol: P };
```

The point selects `P`. The options preserve the literal request tuple; a target can compare a member of that tuple, never widen it. At `definePlugin`, restrict `action.offer` for `kind: 'openView'` to the local keys whose offers have `protocol.kind: 'view'`. The build also verifies the exact destination binding across records. `export { Body as "deployment-status" }` supports a legal local ID that is not a JS binding identifier; private helpers must stay unexported.

</details>

### Body and read typing

```ts
type ReadPage<F extends Fields> = {
  readonly rows: readonly Values<F>[];
  readonly coverage: 'complete' | 'partial';
  readonly truncated: boolean;
};

type Related<F extends Fields> =
  | { readonly state: 'unavailable' | 'loading' | 'failed' }
  | ({ readonly state: 'ready' } & ReadPage<F>);
```

`ViewProps<O>` is `{readonly input: OfferInput<O>}` intersected with `{readonly related: Related<F>}` **only if** the view declares `requestRead: true`, where `F` is its protocol's exact `read.row`. Otherwise **omit the key**. Do not type the input as an unbounded `Record<string, unknown>` or the result as `ReactNode | string` for all kinds. Body signature: `(props: ViewProps<O>) => ReactElement | null`; synchronous, not an instantiated element, async loader or ordinary page Body. Section/info feature results are exact, readonly scalar records, never JSX.

### Identity and compatibility

```text
segment     = [A-Za-z0-9][A-Za-z0-9._-]{0,127}
qualified   = segment "/" segment                 # point OR offer, by role
versioned   = segment "/" segment "@" major       # protocol OR read, by role
major       = [1-9][0-9]{0,8}
binding     = (qualified point, qualified offer)  # ordered pair, not a route
```

IDs and field names are case-sensitive ASCII. Each local point/offer ID, page key and field name is a `segment`; `default` cannot name an executable export. Point and offer namespaces are separate. Labels never identify a grant or route. All points accept zero or many eligible bindings; order by ascending **qualified offer ID in ASCII byte order**, not label, locale, install order or completion time. Keep owner order unchanged.

A point's private protocol namespace and any read namespace must equal the verified installed owner. `host` is not an installable owner; `visuals` is reserved for SDK publications and the lab's `navigation` namespace cannot be redefined. No structural matching across different IDs, ID guessing, wildcards, transitive permissions or implicit targets. An absent external point parks its binding. Reciprocal declarations do not execute each other.

The SDK import `/v1` and wire `schemaVersion: 1` describe a **generation**. The protocol/read major describes **meaning**. Input keys and optionality, result or row shapes, read selection, units, semantics and kind are immutable for that major. Change a contract: publish a new major and new local point if both must coexist. Replacing a point's placement or protocol never silently ports its old grants. The npm contract version tells an author what to install; an installed artifact pin and lifetime govern execution. These are not interchangeable versions.

## Packager reference · fixed assets, no discovery execution

| Asset | Exists when | Contract |
|---|---|---|
| `assets/extensions.v1.json` | The plugin declares extensions. | Closed UTF-8 JSON, ≤256 KiB. Produced by the build, never hand-edited. |
| `assets/extensions.js` | One or more section or `menu`/`info` offers. | One anonymous self-contained `System.register`; zero external deps. Exact named callable exports from `ui/src/features.ts`. ≤1 MiB decoded. |
| `assets/views.js` | One or more `view` offers. | One anonymous `System.register`; exact named function-component exports from `ui/src/views.tsx`. ≤1 MiB decoded. Only the shell's existing React/kit names below. |
| `assets/entry.js` | An ordinary owner/contributor page exists. | Existing page ABI and admission. A route-less Body or scalar contributor does **not** need a home, page, rail or this asset. |

The production view allowlist is a **subset** of the [existing shared list](../../../ui-next/plugins/loader/specifiers.ts): `react`, `react/jsx-runtime`, `react/compiler-runtime`, `@omniviewdev/kit`. `react/jsx-dev-runtime` may substitute on the existing development path, not in a production artifact. No private copy of React/kit, new singleton, `react-dom`, `@omniviewdev/runtime/ui/v1`, runtime root, raw API, CSS injection, external/dynamic imports, authored loader paths, additional chunks or assets in a view/feature bundle. Local pure code is bundled. Format/import checks are not a security sandbox.

The build hook reads `plugin.yaml`, the UI project's TypeScript config, source descriptors and emitted export names. Never execute descriptors, owner contract package JS, features, pages or Bodies to discover metadata. Inspect locked root package `exports`, types and JS entry. Accept named root imports/aliases and root re-exports; reject private paths, deep imports, fabricated locators, nonliteral/unchecked declarations and version ranges. Honor normal plugin build paths. Emit optional assets atomically; remove previous optional assets no longer declared. A pages-only build stays unchanged. No new role tag, dev-only grant, probing absent files or runtime npm resolution.

### Wire grammar

Every object is closed; reject unknown keys, duplicate JSON members and sparse/non-array lists. Omit optional members, do not emit `null`. Every manifest has exactly `schemaVersion`, `id`, `points`, `offers`, `bindings`. `schemaVersion` must be `1`; `id` must match the verified installed source. All three arrays exist, even if empty.

**Points** have `id, label, kind, placement, protocol, contract`. `contract` is the generated `{package, version, export}` for the actual *point* root export. The closed pairs are:

| `kind` | `placement` | Extra point members |
|---|---|---|
| `section` | `overview-section` | `warmOnPage?: segment` |
| `menu` | `context-menu` | None beyond its private definition |
| `view` | `detail-tab` or `sidebar` | None beyond its private definition; sidebar requires an empty, read-free protocol |

**Private definitions** are copied in full onto **both** point and offer records: `fields` is required; `section` also requires `schema: {label:'string', value:'string'}`. `menu`/`view` may carry `optional: segment[]` (omit if no optional keys). Only `view` may include `read: {id: versioned, row: Fields}`. No `schema` on `menu` or `view`. On the published utilization protocol **forbid** the inline definition; the host supplies it. At binding time compare protocol ID, kind, maps, optional key set and read identity/shape, independent of record or key order.

**Offers** have `id, label, kind, protocol, requests` plus the private definition where applicable. `id` is local to the contributor, never an asset path.

| Kind | Additional wire members | Executable lookup |
|---|---|---|
| `section` | None | `extensions.js[offer.id]` |
| `menu` | `action: {kind:'info'}` or `action: {kind:'openView', point: qualified, offer: segment}` | `info`: `extensions.js[offer.id]`; `openView`: no contributed handler. `offer` under `action` names the local destination **view offer**, not this menu offer. |
| `view` | `requestRead?: true` only if `read` declared | `views.js[offer.id]` as a component |

**Bindings** have `offer: segment` (declared in the same manifest) and `target: qualified` (installed owner/local point). Only conditional targets add `when: [{field, equals}, …]`, as specified above. Expand one binding per descriptor target. No duplicate pair, even if conditions differ; no zero-target offer. Resolve a same-source typo at build time; an external owner need not be installed. An `openView` must name an existing local `view` offer with an explicit binding to `action.point` under every invoking target's owner. Independently check actual admitted destination, grant and current owner projection on use.

`contract.package` is a lowercase ASCII npm registry name, optionally `@scope/name`, ≤214 characters. `version` is one exact SemVer 2.0.0 version ≤128 ASCII characters, including any valid prerelease/build suffix. `export` is a non-default named ASCII JS binding identifier ≤128 characters. No URL, version specifier in a name, range, path, alias, tag or automatically installed dependency. Inspectors display this as a **development** locator; it is never a runtime import or authority.

### Two complete generated manifests

These are the complete wire counterparts to recipes 1–4, not templates to copy or grants. The independent utilization example is **not** declared by either package.

<details>
<summary>Owner: <code>kubernetes/assets/extensions.v1.json</code> — four points, no executable offers</summary>

```json
{
  "schemaVersion": 1,
  "id": "kubernetes",
  "points": [
    {
      "id": "deployment-tabs", "label": "Deployment detail tabs", "kind": "view",
      "placement": "detail-tab", "protocol": "kubernetes/deployment-view@1",
      "fields": { "kind": "string", "managedBy": "string" },
      "optional": ["managedBy"],
      "contract": { "package": "@example/kubernetes-points", "version": "1.4.0", "export": "deploymentTabs" }
    },
    {
      "id": "service-tabs", "label": "Service detail tabs", "kind": "view",
      "placement": "detail-tab", "protocol": "kubernetes/service-view@1", "fields": {},
      "read": {
        "id": "kubernetes/service-neighbors@1",
        "row": {
          "direction": "string", "relation": "string", "kind": "string",
          "namespace": "string", "name": "string", "evidence": "string"
        }
      },
      "contract": { "package": "@example/kubernetes-points", "version": "1.4.0", "export": "serviceTabs" }
    },
    {
      "id": "sidebar-tools", "label": "Extensions", "kind": "view",
      "placement": "sidebar", "protocol": "kubernetes/sidebar-view@1", "fields": {},
      "contract": { "package": "@example/kubernetes-points", "version": "1.4.0", "export": "sidebarTools" }
    },
    {
      "id": "terminal-actions", "label": "Pod terminal tab actions", "kind": "menu",
      "placement": "context-menu", "protocol": "kubernetes/terminal-menu@1",
      "fields": { "kind": "string", "managedBy": "string" },
      "optional": ["managedBy"],
      "contract": { "package": "@example/kubernetes-points", "version": "1.4.0", "export": "terminalActions" }
    }
  ],
  "offers": [],
  "bindings": []
}
```

</details>

<details>
<summary>Contributor: <code>gateway-tools/assets/extensions.v1.json</code> — five offers and five explicit bindings</summary>

```json
{
  "schemaVersion": 1,
  "id": "gateway-tools",
  "points": [],
  "offers": [
    {
      "id": "admin", "label": "Kong Admin Manager", "kind": "view",
      "protocol": "kubernetes/sidebar-view@1", "fields": {}, "requests": []
    },
    {
      "id": "rollout", "label": "Rollout", "kind": "view",
      "protocol": "kubernetes/deployment-view@1",
      "fields": { "kind": "string", "managedBy": "string" },
      "optional": ["managedBy"], "requests": ["kind"]
    },
    {
      "id": "topology", "label": "Topology", "kind": "view",
      "protocol": "kubernetes/service-view@1", "fields": {},
      "read": {
        "id": "kubernetes/service-neighbors@1",
        "row": {
          "direction": "string", "relation": "string", "kind": "string",
          "namespace": "string", "name": "string", "evidence": "string"
        }
      },
      "requests": [], "requestRead": true
    },
    {
      "id": "describePod", "label": "Show manager", "kind": "menu",
      "protocol": "kubernetes/terminal-menu@1",
      "fields": { "kind": "string", "managedBy": "string" },
      "optional": ["managedBy"], "requests": ["kind", "managedBy"],
      "action": { "kind": "info" }
    },
    {
      "id": "openAdmin", "label": "Open Kong Admin Manager", "kind": "menu",
      "protocol": "kubernetes/terminal-menu@1",
      "fields": { "kind": "string", "managedBy": "string" },
      "optional": ["managedBy"], "requests": ["kind", "managedBy"],
      "action": { "kind": "openView", "point": "kubernetes/sidebar-tools", "offer": "admin" }
    }
  ],
  "bindings": [
    { "offer": "admin", "target": "kubernetes/sidebar-tools" },
    { "offer": "rollout", "target": "kubernetes/deployment-tabs" },
    { "offer": "topology", "target": "kubernetes/service-tabs" },
    {
      "offer": "describePod", "target": "kubernetes/terminal-actions",
      "when": [{ "field": "kind", "equals": "Pod" }, { "field": "managedBy", "equals": "kong" }]
    },
    {
      "offer": "openAdmin", "target": "kubernetes/terminal-actions",
      "when": [{ "field": "kind", "equals": "Pod" }, { "field": "managedBy", "equals": "kong" }]
    }
  ]
}
```

</details>

Reading the pair: `views.js` must export exactly `admin`, `rollout`, `topology`; `extensions.js` exports only `describePod`. Listing the sidebar or opening the terminal menu evaluates neither module.

* Grant only `['kind']` on the `describePod` binding: **no “Show manager”**, even on a matching Pod. This does not change `openAdmin`'s independent grant.
* Grant `openAdmin` both condition fields, but deny `admin` at the sidebar point: the menu action cannot open that destination.
* An explicit empty scalar grant can mount `admin`. The topology binding needs its **own** scalar grant to mount, and a separate read decision plus native authority for its data.

## Build, admission and delivery gates

**Bounds.** Per installed source: ≤1,024 each of points, offers and bindings; ≤64 keys in a field/schema/request/optional set; 1–64 keys per read row schema. Nonblank labels ≤256 UTF-16 units. Effective scalar input and validated scalar feature result each ≤16 KiB compact UTF-8, strings ≤4,096 UTF-16 units, returned fact label ≤256. The same per-string bound applies to read rows. Reject over-bound data; never truncate into a different fact, condition or claimed-complete read. The [runtime reference](extension-runtime-v1.md) owns fan-out, policy storage, demand and UI limits.

**Compiler boundary.** Require `strict`, `strictNullChecks`, `strictFunctionTypes`, `noImplicitAny`, `exactOptionalPropertyTypes` and no unchecked emit. Collect literal builder data, const tuples/maps, type-preserving composition, `as const`, `satisfies` and literal named exports from packed declarations. Reject widened/open schemas, optional *descriptor* members whose presence is uncertain, unions of possible descriptors, getters, dynamic initializers or assertions fabricating static data. Optional *input fields* are expressed by the literal `optional` tuple, not an uncertain descriptor. Generated bytes must pass the same closed decoder used at install.

| Negative case | Required refusal |
|---|---|
| Wrong owner, invalid local ID, unknown publication, same private protocol/read major with two definitions in one source, unreadable/forged public export | Fail packaging or refuse that installed source. Report the field and expected shape, not live values. A separately valid incompatible peer parks only its binding. |
| `menuOutlet(deploymentTabs, …)`, sidebar with fields/read, section read or `warmOnPage` on a view | Wrong kind/placement, even if objects look alike. A spread or `: PointRef` must not conceal a widened contract. |
| Missing required owner key, wrong value, extra key from an existing variable, `optional` contains an undeclared name | Fail author validation. A condition cannot request a labels map or force a missing fact to become `''`. |
| Wrong target protocol, empty/repeated target, unrequested match, duplicate/fifth match, regex, condition on sidebar | Reject before installation. Never drop the condition and admit a broader row. |
| `openView` names a page, URL, other contributor, other point owner, absent local `view` offer or undeclared destination edge | Reject. A stale/denied destination discovered at activation does nothing, never opens an ordinary page. |
| Body requires `ContextV1`, `input.kind: string`, credentials or a read the offer didn't request; feature returns JSX or requires all requests | Reject against **every permitted input subset**. A handler/Body cannot narrow host props by annotating its own parameters. Runtime still validates callability and all data boundaries. |
| Missing extra asset, stale/extra runtime export, type-only export, unexpected import, oversized bytes or malformed output | Refuse before delivery/activation as applicable. Types alone cannot prove runtime exports or a resolved result has no extra keys. No fallback to a more privileged page module. |
| Related read invoked without native proof or separate grant; raw object/extra row member, unsupported row type, oversize or late answer | No related data. No previous snapshot, hidden scan, synthesized empty graph, or untrusted exception text. Preserve the owner page. |

**Independent developer path.** In **Show extension points** or the **Extension point catalogue**, read placement, protocol major, shape, operation semantics and pinned npm package/version/named export. Build the owner and contributor from those **packed** packages without host-source aliases. Check exact files/exports plus targeted positive and negative compile fixtures. Install in a disposable profile, grant each edge separately and exercise the four scenarios, then revoke during pending work. The [implementation gates](../status/KL-rest.md) require native proof; these recipes and manifests are not that proof.

**What changed from the lab.** Keep static discovery, typed requested subsets, explicit binding identity, byte-only section hints and plain information features. Replace its text-only tab, Overview-only menu and `navigation/page@1` contributor-page redirect with the typed placements above. Replace the single equality with a bounded granted conjunction. Do not preserve `definePageOffer`, parse lab metadata as production, promote sample plugins, infer permissions from a route or claim a general cross-plugin service bus.
