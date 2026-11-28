import type { AccessRoute, ResourceAddress, ResourceReference, ScopeEntry } from './reference.js';

// Only this identity spine enters the private store. No body, generated transport, or UI import.
interface CollectionRecord {
  readonly key: string;
  readonly targetId: string;
  readonly route: AccessRoute;
  readonly record: { readonly reference: ResourceReference };
}

/** An owner-only handle to a current native collection record. It has no public data or constructor. */
export declare class ExtensionRootV1 {
  private constructor();
  private readonly brand: never;
}

type RootReference = {
  readonly address: Readonly<Omit<ResourceAddress, 'scope'>> & { readonly scope: readonly Readonly<ScopeEntry>[] };
  readonly incarnation: string;
};

/** Host-private transport input. Native admission checks it against this window's live source on every use. */
export interface ExtensionRootProof {
  readonly owner: string;
  readonly connection: string;
  readonly reference: RootReference;
  readonly viewId: string;
  readonly viewGeneration: string;
  readonly rowKey: string;
}

interface Member {
  source: CollectionRootSource;
  reference: RootReference;
  revision: string;
  root?: ExtensionRootV1;
}
interface Witness {
  member: Member;
  epoch: number;
  proof: ExtensionRootProof;
  retired?: true;
}
const provenance = new WeakMap<CollectionRecord, Member>();
const issued = new WeakMap<ExtensionRootV1, Witness>();
const unsubscribeNone = () => {};

/** Private to openSourceView: neither the owner entry nor the internal broker entry exports an issuer. */
export class CollectionRootSource {
  private records?: ReadonlyMap<string, CollectionRecord>;
  private generation?: string;
  private epoch = 0;
  private watched?: Map<Witness, Set<() => void>>;

  constructor(private readonly owner: string, private readonly connection: string, private readonly viewId: string,
    private readonly targetId: string, private readonly provider: string, private readonly authority: string,
    private readonly resourceType: string) {}

  sameRevision(record: CollectionRecord, revision: string | undefined): boolean {
    const member = provenance.get(record);
    return member ? member.source === this && member.revision === revision : revision === undefined;
  }

  // Called inside the publication loop, before an owner sees a new record. Keep its identity
  // spine immutable; never traverse, freeze or copy the resource body to issue an identity.
  remember(record: CollectionRecord, revision: string | undefined) {
    if (typeof revision !== 'string' || !/^[1-9][0-9]{0,19}$/.test(revision)) {
      provenance.delete(record);
      return;
    }
    const reference: ResourceReference | undefined = record.record?.reference;
    const address = reference?.address;
    if (!this.owner || !this.connection || !this.viewId || !record.key || !this.targetId || record.targetId !== this.targetId ||
      record.route?.connection !== this.connection || !address?.id || address.provider !== this.provider ||
      address.authority !== this.authority || address.type !== this.resourceType || !Array.isArray(address.scope) ||
      typeof reference?.incarnation !== 'string' || !reference.incarnation) return;
    for (const entry of address.scope) Object.freeze(entry);
    Object.freeze(address.scope);
    Object.freeze(address);
    Object.freeze(reference);
    Object.freeze(record.route);
    Object.freeze(record.record);
    Object.freeze(record);
    provenance.set(record, { source: this, reference: reference as RootReference, revision });
  }

  // The map is already indexed by native row key. Never materialize it, read a copy-on-write snapshot,
  // or wake the collection's coalesced React subscribers to check an extension. Close drops the map.
  publish(generation?: string, records?: ReadonlyMap<string, CollectionRecord>) {
    if (generation !== this.generation) this.epoch++;
    this.generation = generation;
    this.records = records;
    if (!this.watched) return;
    for (const [witness, listeners] of this.watched) {
      if (this.current(witness)) continue;
      this.watched.delete(witness);
      for (const listener of listeners) listener();
    }
  }

  private holds(rowKey: string, member: Member): boolean {
    const record = this.records?.get(rowKey);
    return record !== undefined && provenance.get(record) === member && record.key === rowKey &&
      record.targetId === this.targetId && record.route?.connection === this.connection && record.record?.reference === member.reference;
  }

  current(witness: Witness): boolean {
    if (witness.retired) return false;
    if (this.epoch === witness.epoch && this.generation && this.holds(witness.proof.rowKey, witness.member)) return true;
    witness.retired = true;
    return false;
  }

  root(rowKey: string, member: Member): ExtensionRootV1 | undefined {
    const prior = member.root && issued.get(member.root);
    if (prior && this.current(prior)) return member.root;
    if (!this.generation || !this.holds(rowKey, member)) return undefined;
    const root = Object.freeze({}) as ExtensionRootV1;
    const proof = Object.freeze({ owner: this.owner, connection: this.connection, reference: member.reference,
      viewId: this.viewId, viewGeneration: `${this.generation}:${member.revision}`, rowKey });
    issued.set(root, { member, proof, epoch: this.epoch });
    member.root = root;
    return root;
  }

  subscribe(witness: Witness, listener: () => void): () => void {
    if (!this.current(witness)) return unsubscribeNone;
    const watched = this.watched ??= new Map<Witness, Set<() => void>>();
    let listeners = watched.get(witness);
    if (!listeners) watched.set(witness, listeners = new Set());
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
      if (!listeners.size && watched.get(witness) === listeners) watched.delete(witness);
    };
  }
}

export function collectionRootOf(record: CollectionRecord): ExtensionRootV1 | undefined {
  const member = provenance.get(record);
  return member?.source.root(record.key, member);
}

export function extensionRootProof(root: ExtensionRootV1): ExtensionRootProof | undefined {
  const witness = issued.get(root);
  return witness?.member.source.current(witness) ? witness.proof : undefined;
}

export function subscribeExtensionRoot(root: ExtensionRootV1, listener: () => void): () => void {
  const witness = issued.get(root);
  return witness?.member.source.subscribe(witness, listener) ?? unsubscribeNone;
}
