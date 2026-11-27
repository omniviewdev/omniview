import {
  prepareExtensionSource, sameNames, type DeclaredExtensionPoint, type ExtensionOffer, type ExtensionPoint,
  type ExtensionSource, type PreparedEdge, type PreparedPoint, type PreparedSource,
} from './extensionContract';
import { matchesExtension, projectExtension, sameInput, type ExtensionInput, type ProjectionRule } from './extensionProjection';

export type { ExtensionSource, DeclaredExtensionPoint } from './extensionContract';

export type ExtensionPair = { readonly point: string; readonly offer: string };
type PolicyImpact = ExtensionPair & { readonly fields?: readonly string[]; readonly readOnly?: true };
export type ExtensionGrant = ExtensionPair & {
  readonly ownerPin: string;
  readonly contributorPin: string;
  readonly contract: string;
  readonly fields: readonly string[];
  readonly read?: string;
  readonly continuity: string;
};

/** A bounded, validated snapshot from the private native profile store. No plugin or event can supply grants. */
export type ExtensionPolicy = {
  readonly known: boolean;
  readonly revision: string;
  readonly disabled: boolean;
  readonly grants: readonly ExtensionGrant[];
  readonly disabledOffers: readonly string[];
  readonly disabledBindings: readonly ExtensionPair[];
};

export type ExtensionBinding = ExtensionPair & {
  readonly ownerPin: string;
  readonly ownerGeneration: string;
  readonly contributorPin: string;
  readonly contributorGeneration: string;
  /** Native-verified, frozen role export lists, each unique to this source lifetime and window. */
  readonly featureExports: readonly string[];
  readonly viewExports: readonly string[];
  /** New on every admission, even for the same pins and effective fields. */
  readonly generation: number;
  /** Survives only proven scalar-grant continuity, including a change solely to the independent read grant. */
  readonly selectionGeneration: number;
  readonly declaration: ExtensionOffer;
  readonly placement: ExtensionPoint['placement'];
  readonly fields: readonly string[];
  /** Present only when the offer requested this exact independently granted read. Not native authority to execute it. */
  readonly read?: string;
};

/** Host-only proof from the displayed owner adapter. The caller has verified the subject/connection, not inferred them from a route. */
export type ExtensionOutlet = {
  readonly owner: string;
  readonly point: string;
  readonly placement: ExtensionPoint['placement'];
  readonly visible: boolean;
  readonly ready: boolean;
  readonly visit: Record<string, unknown>;
  readonly subject: string;
  readonly connection?: string;
  readonly scopeKey?: string;
  readonly context: unknown;
};

/** Opaque by identity. Neither a lease nor any part of the host's scope proof is a contributor prop. */
export type ExtensionPlacement = { readonly point: string; readonly generation: number };
export type ExtensionDemand = {
  readonly binding: ExtensionBinding;
  readonly placement: ExtensionPlacement;
  readonly generation: number;
  readonly input: ExtensionInput;
  readonly signal: AbortSignal;
};

/** Only a fresh publication from this same live holder can signal an eligible replacement projection. Never replay a menu choice. */
export const EXTENSION_INPUT_CHANGED = Symbol('extension input changed');

type Source = {
  readonly row: ExtensionSource;
  ordinaryReady: boolean;
  refused: boolean;
  pending?: Promise<void>;
  prepared?: PreparedSource;
};
type Published = { readonly point: PreparedPoint; readonly source: Source };
type Offered = { readonly edge: PreparedEdge; readonly source: Source };
type Row = {
  readonly binding: ExtensionBinding;
  readonly owner: Published;
  readonly peer: Offered;
  continuity: string | undefined;
  readonly rule: ProjectionRule;
};
type PointSnapshot = {
  readonly declared: Published | undefined;
  readonly owner: Published | undefined;
  readonly bindings: readonly ExtensionBinding[];
  readonly rows: ReadonlyMap<string, Row>;
};
type Grants = Map<string, Map<string, ExtensionGrant>>;
type Lease = {
  readonly token: ExtensionPlacement;
  readonly holder: Record<string, unknown>;
  readonly owner: Published;
  readonly demands: Map<ExtensionBinding, Demand>;
  outlet: ExtensionOutlet;
  version: number;
};
/** Host-only lookup of independently eligible menu destinations. Never a callback supplied by an extension. */
type MenuScreen = (binding: ExtensionBinding) => boolean;
type Demand = {
  readonly controller: AbortController;
  readonly lease: Lease;
  readonly row: Row;
  readonly menuScreen?: MenuScreen;
  checking: boolean;
  token?: ExtensionDemand;
};

const NO_BINDINGS: readonly ExtensionBinding[] = Object.freeze([]);
const EMPTY_POINT: PointSnapshot = { declared: undefined, owner: undefined, bindings: NO_BINDINGS, rows: new Map() };
const SURFACE_LIMIT = { 'overview-section': 4, 'detail-tab': 4, 'context-menu': 12, sidebar: 16 } as const;

function accepted(binding: ExtensionBinding, screen: MenuScreen | undefined): boolean {
  if (!screen) {
    return true;
  }

  try {
    return screen(binding);
  } catch {
    return false; // A failed destination lookup costs this offer, not a sibling or the owner's menu.
  }
}

function sameConsent(a: ExtensionGrant, b: ExtensionGrant): boolean {
  return a.continuity === b.continuity && a.ownerPin === b.ownerPin && a.contributorPin === b.contributorPin &&
    a.contract === b.contract && a.read === b.read && sameNames(a.fields, b.fields);
}

/** All three lists are sorted ASCII. Prove that the native reread changed exactly the named fields and no others. */
function sameFieldEdit(before: readonly string[], after: readonly string[], expected: readonly string[]): boolean {
  let left = 0, right = 0, changed = 0;
  while (left < before.length || right < after.length) {
    const a = before[left], b = after[right];
    if (a === b) {
      left++;
      right++;
      continue;
    }

    const field = b === undefined || (a !== undefined && a < b) ? before[left++] : after[right++];
    if (field !== expected[changed++]) {
      return false;
    }
  }

  return changed === expected.length;
}

function unrequestedEdit(fields: unknown, requests: readonly string[]): fields is readonly string[] {
  if (!Array.isArray(fields) || !fields.length || fields.length > 128) {
    return false;
  } // Two disjoint 64-field grants.

  let previous = '';
  for (const field of fields) {
    if (typeof field !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(field) ||
        field === 'constructor' || field === 'prototype' || field <= previous || requests.includes(field)) {
      return false;
    }

    previous = field;
  }

  return true;
}

/** One authority per window. This class neither evaluates a module nor subscribes to a resource, terminal or renderer. */
export class ExtensionAuthority {
  #disposed = false;
  #serial = 0;
  readonly #sources = new Map<string, Source>();
  readonly #points = new Map<string, Published>();
  readonly #edges = new Map<string, Map<string, Offered>>();
  #grants: Grants = new Map();
  readonly #fieldEdits = new Map<Row, { revision: string; fields: readonly string[] }>();
  readonly #readEdits = new Map<ExtensionGrant, { readonly before: ExtensionGrant; readonly revision: string }>();
  readonly #cache = new Map<string, PointSnapshot>();
  readonly #listeners = new Map<string, Set<() => void>>();
  readonly #holders = new WeakMap<Record<string, unknown>, Lease>();
  readonly #leases = new Map<ExtensionPlacement, Lease>();
  readonly #placements = new Map<string, Set<Lease>>();
  readonly #demands = new WeakMap<ExtensionDemand, Demand>();
  #foreground?: Demand;
  #selectedView?: Demand;
  #viewVisit = 0;
  readonly #updatedViews = new WeakMap<ExtensionDemand, { readonly visit: number; readonly committed: boolean }>();

  /** Replace the complete verified/Running set. Withdraw old work before awaiting any digest, including on a bad replacement. */
  async replaceSources(rows: readonly ExtensionSource[]): Promise<void> {
    if (this.#disposed) {
      return;
    }

    const inventory = new Map<string, ExtensionSource | undefined>();
    for (const row of rows) {
      const valid = !inventory.has(row.id) && /^sha256:[0-9a-f]{64}$/.test(row.pin) && typeof row.generation === 'string' &&
        row.generation !== '' && typeof row.manifest === 'string' && row.manifest.length <= 256 * 1024 &&
        Array.isArray(row.features) && row.features.length <= 1024 && Array.isArray(row.views) && row.views.length <= 1024;
      inventory.set(row.id, valid ? row : undefined);
    }

    const dirty = new Set<string>();
    const reads: Array<Promise<void>> = [];
    for (const [id, source] of this.#sources) {
      const next = inventory.get(id);
      if (next?.pin !== source.row.pin) {
        this.#withdraw(source, dirty);
        this.#sources.delete(id);
      } else if (next.manifest !== source.row.manifest || !sameNames(next.features, source.row.features) || !sameNames(next.views, source.row.views)) {
        // Replacement bytes or contradictory role evidence under a retained pin can never become a new authority.
        this.#withdraw(source, dirty);
        source.refused = true;
      } else if (next.generation !== source.row.generation) {
        this.#withdraw(source, dirty);
        this.#sources.delete(id);
      }
    }

    for (const row of inventory.values()) {
      if (!row) {
        continue;
      }

      let source = this.#sources.get(row.id);
      if (source) {
        if (source.ordinaryReady !== (row.ordinaryReady)) {
          source.ordinaryReady = row.ordinaryReady;
          for (const point of source.prepared?.points ?? []) {
            dirty.add(point.info.point);
          }
        }
      } else {
        source = { row: { ...row, features: Object.freeze([...row.features]), views: Object.freeze([...row.views]) }, ordinaryReady: row.ordinaryReady, refused: false };
        this.#sources.set(row.id, source);
        source.pending = this.#prepare(source);
      }

      if (source.pending) {
        reads.push(source.pending);
      }
    }

    this.#refresh(dirty);
    await Promise.all(reads);
  }

  retireSource(id: string): void {
    const source = this.#sources.get(id);
    if (!source) {
      return;
    }

    const dirty = new Set<string>();
    this.#withdraw(source, dirty);
    this.#sources.delete(id);
    this.#refresh(dirty);
  }

  clearSources(): void {
    const dirty = new Set<string>();
    for (const source of this.#sources.values()) {
      this.#withdraw(source, dirty);
    }

    this.#sources.clear();
    this.#refresh(dirty);
  }

  /** An ordinary owner adapter is required for its points, never for a route-less contributor's offers. */
  setOrdinaryReady(id: string, ready: boolean): void {
    const source = this.#sources.get(id);
    if (!source || source.ordinaryReady === ready) {
      return;
    }

    source.ordinaryReady = ready;
    this.#refresh(new Set(source.prepared?.points.map(point => point.info.point)));
  }

  replacePolicy(snapshot: ExtensionPolicy): void {
    if (this.#disposed) {
      return;
    }

    if (!snapshot.known || snapshot.disabled || !snapshot.revision || snapshot.grants.length > 1024) {
      this.clearPolicy();
      return;
    }

    const disabledOffers = new Set(snapshot.disabledOffers);
    const disabledPairs = new Set(snapshot.disabledBindings.map(({ point, offer }) => `${point}|${offer}`));
    const seen = new Set<string>();
    const next: Grants = new Map();
    const dirty = new Set<string>();
    for (const grant of snapshot.grants) {
      const key = `${grant.point}|${grant.offer}`;
      if (seen.has(key) || !grant.continuity || grant.fields.length > 64) {
        this.clearPolicy();
        return;
      }

      seen.add(key);
      if (disabledOffers.has(grant.offer) || disabledPairs.has(key)) {
        continue;
      }

      let list = next.get(grant.point);
      if (!list) {
        next.set(grant.point, list = new Map());
      }

      const previous = this.#grants.get(grant.point)?.get(grant.offer);
      const row = { ...grant, fields: [...grant.fields].sort() };
      if (previous && sameConsent(previous, row)) {
        list.set(grant.offer, previous);
      } else {
        dirty.add(grant.point);
        list.set(grant.offer, row);
      }
    }

    for (const [point, old] of this.#grants) {
      if (old.size !== next.get(point)?.size) {
        dirty.add(point);
      }
    }

    for (const [withheld, { before, revision }] of this.#readEdits) {
      const { point, offer } = withheld;
      const row = this.#cache.get(point)?.rows.get(offer);
      if (!row || this.#grants.get(point)?.get(offer) !== withheld) {
        continue;
      }

      const after = next.get(point)?.get(offer);
      // The event could remove a read, not add it. Prove an adjacent change to exactly the read before retaining selection.
      row.continuity = after && row.continuity === before.continuity && revision === snapshot.revision && revision === after.continuity &&
        before.ownerPin === after.ownerPin && before.contributorPin === after.contributorPin && before.contract === after.contract &&
        before.read !== after.read && sameNames(before.fields, after.fields) ? after.continuity : undefined;
      dirty.add(point);
    }

    this.#readEdits.clear();
    for (const [row, edit] of this.#fieldEdits) {
      const { point, offer } = row.binding;
      const prior = this.#grants.get(point)?.get(offer);
      const after = next.get(point)?.get(offer);
      // The notification could preserve an existing disclosure, never issue a grant. Only this exact linked successor
      // may carry its lifetime forward. An unexpected revision, even with identical values, must construct a fresh row.
      row.continuity = prior && after && edit.revision === snapshot.revision && edit.revision === after.continuity &&
        prior.continuity === row.continuity && prior.ownerPin === after.ownerPin && prior.contributorPin === after.contributorPin &&
        prior.contract === after.contract && prior.read === after.read && sameFieldEdit(prior.fields, after.fields, edit.fields)
        ? after.continuity : undefined;
      dirty.add(point);
    }

    this.#fieldEdits.clear();
    this.#grants = next;
    this.#refresh(dirty);
  }

  /** Only supply `revision` for an authenticated change linked to the last verified revision. No event can grant access. */
  retireGrants(affected: readonly PolicyImpact[], revision?: string): void {
    const dirty = new Set<string>();
    for (const { point, offer, fields, readOnly } of affected) {
      const grants = this.#grants.get(point);
      const row = this.#cache.get(point)?.rows.get(offer);
      const grant = grants?.get(offer);
      if (row && grant && grant.continuity === row.continuity && !this.#fieldEdits.has(row) && !this.#readEdits.has(grant) &&
          typeof revision === 'string' && revision !== '' && revision !== row.continuity) {
        if (readOnly === true && fields === undefined) {
          const withheld = { ...grant, read: undefined };
          grants!.set(offer, withheld);
          this.#readEdits.set(withheld, { before: grant, revision });
          dirty.add(point);
          continue;
        }

        if (readOnly === undefined && unrequestedEdit(fields, row.binding.declaration.requests)) {
          this.#fieldEdits.set(row, { revision, fields: [...fields] });
          continue;
        }
      }

      if (grants?.delete(offer)) {
        dirty.add(point);
        if (!grants.size) {
          this.#grants.delete(point);
        }
      }
    }

    this.#refresh(dirty);
  }

  clearPolicy(): void {
    const dirty = new Set(this.#grants.keys());
    this.#fieldEdits.clear();
    this.#readEdits.clear();
    this.#grants.clear();
    this.#refresh(dirty);
  }

  /** Static catalogue data only. Absence, a declaration or an empty point is never an activation request. */
  declaredPoint(point: string): DeclaredExtensionPoint | undefined {
    return this.#points.get(point)?.point.info; 
  }

  point(point: string): readonly ExtensionBinding[] {
    return this.#snapshot(point).bindings; 
  }

  /** A verified terminal can screen its owner before running an adapter. No session or resource data is consulted. */
  hasMenuBindings(owner: string, generation: string): boolean {
    const source = this.#sources.get(owner);
    return source?.ordinaryReady === true && source.row.generation === generation && source.prepared?.points.some(({ info }) =>
      info.declaration.placement === 'context-menu' && this.#snapshot(info.point).bindings.length !== 0) === true;
  }

  /** A menu opening may ask its owner which local point it places. Watch that owner's menu points only until the opening retires. */
  subscribeMenuBindings(owner: string, generation: string, listener: () => void): () => void {
    const source = this.#sources.get(owner);
    const stops: Array<() => void> = [];
    if (source?.ordinaryReady && source.row.generation === generation && source.prepared) {
      for (const { info } of source.prepared.points) {
        if (info.declaration.placement === 'context-menu') {
          stops.push(this.subscribePoint(info.point, listener));
        }
      }
    }

    return () => {
      for (const stop of stops) {
        stop();
      }
    };
  }

  subscribePoint(point: string, listener: () => void): () => void {
    if (this.#disposed) {
      return () => undefined;
    }

    let listeners = this.#listeners.get(point);
    if (!listeners) {
      this.#listeners.set(point, listeners = new Set());
    }

    listeners.add(listener);
    this.#snapshot(point);
    return () => {
      listeners.delete(listener);
      if (!listeners.size && this.#listeners.get(point) === listeners) {
        this.#listeners.delete(point);
        if (!this.#points.has(point)) {
          this.#cache.delete(point);
        }
      }
    };
  }

  /** The holder identifies one real outlet; a visit identifies one showing, not a URL. Pass undefined synchronously on hide. */
  setPlacement(holder: Record<string, unknown>, outlet: ExtensionOutlet | undefined): ExtensionPlacement | undefined {
    const old = this.#holders.get(holder);
    const owner = outlet && this.#snapshot(outlet.point).owner;
    const valid = owner && outlet && outlet.ready && outlet.visible && outlet.owner === owner.source.row.id &&
      outlet.placement === owner.point.info.declaration.placement && typeof outlet.subject === 'string' && outlet.subject !== '' &&
      typeof outlet.visit === 'object' && outlet.visit !== null &&
      (outlet.connection === undefined || (typeof outlet.connection === 'string' && outlet.connection !== '')) &&
      (outlet.placement === 'sidebar' ? outlet.scopeKey === undefined : typeof outlet.scopeKey === 'string' && outlet.scopeKey.length > 0 && outlet.scopeKey.length <= 256);
    if (old && valid && old.owner === owner && old.outlet.visit === outlet.visit && old.outlet.subject === outlet.subject &&
        old.outlet.connection === outlet.connection && old.outlet.scopeKey === outlet.scopeKey) {
      old.outlet = { ...outlet };
      old.version++;
      for (const demand of [...old.demands.values()]) {
        if (!demand.token || demand.checking) {
          this.#cancel(demand);
        } else {
          this.#check(demand.token, true);
        } // Equal projected scalars on the same live incarnation preserve this demand.
      }

      return this.#holders.get(holder)?.token === old.token ? old.token : undefined;
    }

    const abort: AbortController[] = [];
    if (old) {
      this.#close(old, abort);
    }

    let token: ExtensionPlacement | undefined;
    if (valid && !this.#disposed) {
      token = Object.freeze({ point: outlet.point, generation: ++this.#serial });
      const lease: Lease = { token, holder, owner, outlet: { ...outlet }, demands: new Map(), version: 0 };
      this.#leases.set(token, lease);
      this.#holders.set(holder, lease);
      let placements = this.#placements.get(token.point);
      if (!placements) {
        this.#placements.set(token.point, placements = new Set());
      }

      placements.add(lease);
    }

    for (const controller of abort) {
      controller.abort();
    }

    return this.#holders.get(holder)?.token === token ? token : undefined;
  }

  endPlacement(token: ExtensionPlacement): void {
    const lease = this.#leases.get(token);
    if (!lease) {
      return;
    }

    const abort: AbortController[] = [];
    this.#close(lease, abort);
    for (const controller of abort) {
      controller.abort();
    }
  }

  eligible(token: ExtensionPlacement, menuScreen?: MenuScreen): readonly ExtensionBinding[] {
    const lease = this.#leases.get(token);
    if (!lease || (menuScreen && lease.outlet.placement !== 'context-menu')) {
      return NO_BINDINGS;
    }

    const snapshot = this.#snapshot(token.point);
    const version = lease.version;
    const current = () => this.#leases.get(token) === lease && lease.version === version && this.#cache.get(token.point) === snapshot;
    const bindings: ExtensionBinding[] = [];
    for (const row of snapshot.rows.values()) {
      if (matchesExtension(row.rule, lease.outlet.context, current) && accepted(row.binding, menuScreen)) {
        bindings.push(row.binding);
      }

      if (!current()) {
        return NO_BINDINGS;
      }

      if (bindings.length === SURFACE_LIMIT[lease.outlet.placement]) {
        break;
      }
    }

    return bindings.length ? Object.freeze(bindings) : NO_BINDINGS;
  }

  /** A menu rechecks its host destination screen at dispatch and settlement. Only a previously withdrawn view may request a projection refresh. */
  beginDemand(token: ExtensionPlacement, binding: ExtensionBinding, qualification?: MenuScreen | ExtensionDemand): ExtensionDemand | undefined {
    const lease = this.#leases.get(token);
    const row = this.#cache.get(token.point)?.rows.get(binding.offer);
    const menuScreen = typeof qualification === 'function' ? qualification : undefined;
    const updatedView = typeof qualification === 'function' ? undefined : qualification;
    if (!lease || row?.binding !== binding || (menuScreen && lease.outlet.placement !== 'context-menu')) {
      return undefined;
    }

    const update = updatedView && this.#updatedViews.get(updatedView);
    if (updatedView) {
      this.#updatedViews.delete(updatedView);
      if (update?.visit !== this.#viewVisit || updatedView.placement !== token || updatedView.binding !== binding ||
          this.#selectedView !== undefined || (!update.committed && this.#foreground !== undefined)) {
        return undefined;
      }
    }

    const abort: AbortController[] = [];
    const previous = lease.demands.get(binding);
    if (previous) {
      this.#retire(previous, abort);
    }

    // Refreshing an already committed Body uses its resident role. Do not displace an independent live menu choice.
    const foreground = binding.declaration.kind !== 'section' && !update?.committed;
    if (foreground && this.#foreground) {
      this.#retire(this.#foreground, abort);
    }

    if (binding.declaration.kind === 'view' && this.#selectedView) {
      this.#retire(this.#selectedView, abort);
    }

    const demand: Demand = { lease, row, menuScreen, controller: new AbortController(), checking: true };
    lease.demands.set(binding, demand);
    if (foreground) {
      this.#foreground = demand;
    }

    if (binding.declaration.kind === 'view') {
      this.#viewVisit++;
      this.#selectedView = demand;
    }

    for (const controller of abort) {
      controller.abort();
    }

    const input = this.#project(demand);
    demand.checking = false;
    if (!input) {
      this.#cancel(demand);
      return undefined;
    }

    demand.token = Object.freeze({ placement: token, binding, generation: ++this.#serial, input, signal: demand.controller.signal });
    this.#demands.set(demand.token, demand);
    return demand.token;
  }

  /** A committed Body no longer loads on the foreground lane. A menu may run beside it without acquiring or retiring its mount/read. */
  viewCommitted(token: ExtensionDemand): void {
    const demand = this.#demands.get(token);
    if (demand && this.#selectedView === demand && this.#foreground === demand) {
      this.#foreground = undefined;
    }
  }

  /** Recheck before/after I/O, before dispatch and at display, for failures as well as successes. Abort cooperation is not required. */
  current(token: ExtensionDemand): boolean {
    return this.#check(token, false);
  }

  /** Private native dispatch context. A root, subject string or contributor-provided route cannot stand in for this lease. */
  readScope(token: ExtensionDemand): { readonly subject: string; readonly connection: string; readonly scopeKey: string; readonly continuity: string } | undefined {
    if (!this.current(token)) {
      return undefined;
    }

    const demand = this.#demands.get(token)!;
    const { binding, continuity } = demand.row;
    const { subject, connection, scopeKey } = demand.lease.outlet;
    if (binding.placement !== 'detail-tab' || binding.declaration.kind !== 'view' || !binding.declaration.requestRead ||
        !binding.read || !continuity || !connection || !scopeKey) {
      return undefined;
    }

    return { subject, connection, scopeKey, continuity };
  }

  endDemand(token: ExtensionDemand): void {
    const demand = this.#demands.get(token);
    if (demand) {
      this.#cancel(demand);
    }
  }

  dispose(): void {
    this.#disposed = true;
    this.clearSources();
    this.#grants.clear();
    this.#listeners.clear();
    this.#cache.clear();
  }

  #check(token: ExtensionDemand, published: boolean): boolean {
    const demand = this.#demands.get(token);
    if (!demand || demand.checking) {
      return false;
    }

    demand.checking = true;
    const input = this.#project(demand);
    demand.checking = false;
    if (input && sameInput(input, token.input)) {
      return true;
    }

    // Only setPlacement published new owner data. A getter/proxy changing at display, role failure, or a stale grant is not a retry.
    const changed = published && input !== undefined && token.binding.declaration.kind !== 'menu';
    if (changed && demand === this.#selectedView) {
      this.#updatedViews.set(token, { visit: this.#viewVisit, committed: demand !== this.#foreground });
    }

    this.#cancel(demand, changed ? EXTENSION_INPUT_CHANGED : undefined);
    return false;
  }

  async #prepare(source: Source): Promise<void> {
    let prepared: PreparedSource;
    try {
      prepared = await prepareExtensionSource(source.row);
    } catch {
      source.refused = true;
      source.pending = undefined;
      return;
    }

    source.pending = undefined;
    if (source.refused || this.#sources.get(source.row.id) !== source) {
      return;
    }

    source.prepared = prepared;
    const dirty = new Set<string>();
    for (const point of prepared.points) {
      dirty.add(point.info.point);
      this.#points.set(point.info.point, { point, source });
    }

    for (const edge of prepared.edges) {
      dirty.add(edge.edge.target);
      let byOffer = this.#edges.get(edge.edge.target);
      if (!byOffer) {
        this.#edges.set(edge.edge.target, byOffer = new Map());
      }

      byOffer.set(edge.name, { edge, source });
    }

    this.#refresh(dirty);
  }

  #withdraw(source: Source, dirty: Set<string>): void {
    if (!source.prepared) {
      return;
    }

    for (const point of source.prepared.points) {
      dirty.add(point.info.point);
      this.#points.delete(point.info.point);
    }

    for (const { edge, name } of source.prepared.edges) {
      dirty.add(edge.target);
      const byOffer = this.#edges.get(edge.target)!;
      byOffer.delete(name);
      if (!byOffer.size) {
        this.#edges.delete(edge.target);
      }
    }

    source.prepared = undefined;
  }

  #snapshot(point: string): PointSnapshot {
    const cached = this.#cache.get(point);
    if (cached) {
      return cached;
    }

    if (!this.#points.has(point) && !this.#listeners.has(point)) {
      return EMPTY_POINT;
    }

    const snapshot = this.#resolve(point, EMPTY_POINT);
    this.#cache.set(point, snapshot);
    return snapshot;
  }

  #resolve(point: string, before: PointSnapshot): PointSnapshot {
    const declared = this.#points.get(point);
    const owner = declared?.source.ordinaryReady ? declared : undefined;
    const byOffer = this.#edges.get(point);
    const grants = this.#grants.get(point);
    const rows = new Map<string, Row>();
    if (owner && byOffer && grants) {
      // Only explicit grants can be statically eligible. Never scan all installed packages or evaluate a predicate here.
      for (const name of [...grants.keys()].sort()) {
        const peer = byOffer.get(name);
        if (!peer) {
          continue;
        }

        const { info, protocol } = owner.point;
        const { offer, edge } = peer.edge;
        const grant = grants.get(name)!;
        if (peer.edge.protocol.key !== protocol.key || (edge.when !== undefined && info.declaration.placement === 'sidebar') ||
            grant.ownerPin !== info.ownerPin || grant.contributorPin !== peer.source.row.pin || grant.contract !== info.contract) {
          continue;
        }

        const effective = offer.requests.filter(key => Object.hasOwn(protocol.fields, key) && grant.fields.includes(key));
        if (edge.when?.some(({ field }) => !effective.includes(field))) {
          continue;
        }

        const read = offer.kind === 'view' && offer.requestRead && info.read === grant.read ? info.read : undefined;
        const previous = before.rows.get(name);
        const sameScalar = previous?.owner === owner && previous.peer === peer && previous.continuity === grant.continuity &&
          sameNames(previous.rule.effective, effective);
        if (sameScalar && previous.binding.read === read) {
          rows.set(name, previous);
        } else {
          const fields = Object.freeze(effective);
          const generation = ++this.#serial;
          const binding: ExtensionBinding = Object.freeze({ point, offer: name, ownerPin: info.ownerPin, ownerGeneration: info.sourceGeneration,
            contributorPin: peer.source.row.pin, contributorGeneration: peer.source.row.generation, viewExports: peer.source.row.views,
            featureExports: peer.source.row.features, generation, selectionGeneration: sameScalar ? previous.binding.selectionGeneration : generation,
            declaration: offer, placement: info.declaration.placement, fields, ...(read === undefined ? {} : { read }) });
          rows.set(name, { binding, owner, peer, continuity: grant.continuity,
            rule: { fields: protocol.fields, optional: protocol.optional, effective: fields, when: edge.when } });
        }

        if (rows.size === 32) {
          break;
        }
      }
    }

    if (before.declared === declared && before.owner === owner && rows.size === before.rows.size &&
        [...rows.values()].every((row, i) => row.binding === before.bindings[i])) {
      return before;
    }

    const bindings = rows.size ? Object.freeze([...rows.values()].map(row => row.binding)) : NO_BINDINGS;
    return { declared, owner, rows, bindings };
  }

  #refresh(dirty: ReadonlySet<string>): void {
    const abort: AbortController[] = [];
    const checkVisibility: Demand[] = [];
    const notify = new Set<() => void>();
    for (const point of dirty) {
      const before = this.#cache.get(point);
      if (!before) {
        continue;
      } // Never materialized. Index updates alone suffice until its first consumer.

      const next = this.#resolve(point, before);
      if (next === before) {
        continue;
      }

      this.#cache.set(point, next);
      if (this.#fieldEdits.size) {
        for (const [offer, row] of before.rows) {
          if (next.rows.get(offer) !== row) {
            this.#fieldEdits.delete(row);
          }
        }
      }

      for (const lease of this.#placements.get(point) ?? []) {
        if (lease.owner !== next.owner) {
          this.#close(lease, abort);
        } else {
          for (const [binding, demand] of lease.demands) {
            if (next.rows.get(binding.offer) !== demand.row) {
              this.#retire(demand, abort);
            } else {
              const rank = next.bindings.indexOf(binding);
              if (rank >= SURFACE_LIMIT[lease.outlet.placement] &&
                next.bindings.some((candidate, index) => index < rank && candidate !== before.bindings[index])) {
                checkVisibility.push(demand);
              }
            }
          }
        }
      }

      if (!next.declared && !this.#listeners.has(point)) {
        this.#cache.delete(point);
      }

      for (const listener of this.#listeners.get(point) ?? []) {
        notify.add(listener);
      }
    }

    // A newly eligible earlier sibling may have pushed a live choice past its surface cap. All point indexes already agree.
    for (const demand of checkVisibility) {
      if (demand.token && !demand.checking) {
        this.current(demand.token);
      }
    }

    // All affected rows and signals' authority are fenced before even the first reentrant abort listener or subscriber.
    for (const controller of abort) {
      controller.abort();
    }

    for (const listener of notify) {
      listener();
    }
  }

  #close(lease: Lease, abort: AbortController[]): void {
    this.#leases.delete(lease.token);
    this.#holders.delete(lease.holder);
    const placements = this.#placements.get(lease.token.point)!;
    placements.delete(lease);
    if (!placements.size) {
      this.#placements.delete(lease.token.point);
    }

    for (const demand of lease.demands.values()) {
      this.#retire(demand, abort);
    }
  }

  #project(demand: Demand): ExtensionInput | undefined {
    const { lease, row } = demand;
    const snapshot = this.#cache.get(lease.token.point);
    if (snapshot?.rows.get(row.binding.offer) !== row) {
      return undefined;
    }

    const version = lease.version;
    const current = () => lease.demands.get(row.binding) === demand && this.#leases.get(lease.token) === lease &&
      lease.version === version && this.#cache.get(lease.token.point) === snapshot;
    if (!current()) {
      return undefined;
    }

    // Do not inspect a sibling's predicates unless they could put this selection beyond the visible cap.
    const limit = SURFACE_LIMIT[lease.outlet.placement];
    if (snapshot.bindings.indexOf(row.binding) >= limit) {
      let count = 0;
      for (const other of snapshot.rows.values()) {
        if (other === row) {
          break;
        }

        if (matchesExtension(other.rule, lease.outlet.context, current) && accepted(other.binding, demand.menuScreen) && ++count === limit) {
          return undefined;
        }

        if (!current()) {
          return undefined;
        }
      }
    }

    const { menuScreen } = demand;
    return projectExtension(row.rule, lease.outlet.context, current, menuScreen && (() => accepted(row.binding, menuScreen)));
  }

  #retire(demand: Demand, abort: AbortController[]): void {
    if (demand.lease.demands.get(demand.row.binding) !== demand) {
      return;
    }

    demand.lease.demands.delete(demand.row.binding);
    if (this.#foreground === demand) {
      this.#foreground = undefined;
    }

    if (this.#selectedView === demand) {
      this.#selectedView = undefined;
    }

    if (demand.token) {
      this.#demands.delete(demand.token);
    }

    abort.push(demand.controller);
  }

  #cancel(demand: Demand, reason?: symbol): void {
    const abort: AbortController[] = [];
    this.#retire(demand, abort);
    for (const controller of abort) {
      controller.abort(reason);
    }
  }
}
