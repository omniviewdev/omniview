/** Pure authoring data. These builders do not register, discover or authorize anything. */
type Fields = Readonly<Record<string, 'number' | 'string'>>;
type Key<F extends Fields> = Extract<keyof F, string>;
type Scalar<Tag> = Tag extends 'number' ? number : Tag extends 'string' ? string : never;
type Values<F extends Fields> = { readonly [K in keyof F]: Scalar<F[K]> };
type FactSchema = { readonly label: 'string'; readonly value: 'string' };
type Versioned = `${string}/${string}@${number}`;
type ReadRef = { readonly id: string; readonly row: Fields };

type Definition =
  | { readonly kind: 'section'; readonly fields: Fields; readonly schema: FactSchema }
  | { readonly kind: 'menu'; readonly fields: Fields; readonly optional?: readonly string[] }
  | { readonly kind: 'view'; readonly fields: Fields; readonly optional?: readonly string[]; readonly read?: ReadRef };

/** Used and capacity refer to the same unit. Missing or invalid capacity is not zero utilization. */
export const utilizationV1 = Object.freeze({
  id: 'visuals/utilization@1',
  published: true,
  kind: 'section',
  fields: Object.freeze({ used: 'number', capacity: 'number' } as const),
  schema: Object.freeze({ label: 'string', value: 'string' } as const),
} as const);

/** The SDK publication or the complete definition of a private protocol. Preserve literals in named point exports. */
export type Protocol = typeof utilizationV1 | (Definition & { readonly id: string; readonly published: false });
type Kind = Protocol['kind'];
type ProtocolOf<K extends Kind> = Extract<Protocol, { readonly kind: K }>;
type Placements = {
  section: { readonly placement: 'overview-section'; readonly warmOnPage?: string };
  menu: { readonly placement: 'context-menu' };
  view: { readonly placement: 'detail-tab' | 'sidebar' };
};
type PointOptions<P extends Protocol> = { readonly label: string } & Placements[P['kind']];

/** A reference, not a handle. Annotations of this broad type erase a point's public contract. */
export type PointRef<P extends Protocol = Protocol> = P extends Protocol
  ? { readonly owner: string; readonly id: string; readonly protocol: P } & PointOptions<P>
  : never;

type Only<A, K extends PropertyKey> = A & Record<Exclude<keyof A, K>, never>;
// Unlike optional owner input, descriptor members must be definitely present or definitely absent.
type Declaration<A, K extends PropertyKey> = Only<Required<A>, K>;
type ClosedMap<M> = string extends keyof M ? never
  : Exclude<keyof M, string> extends never ? Required<M> : never;
type Row<F extends Fields> = keyof F extends never ? never : ClosedMap<F>;
type Literal<S extends string> = string extends S ? never : S;
type ConcreteProtocol<P extends Protocol> = { readonly id: Literal<P['id']> } & CheckedDefinition<P, 'id' | 'published'>
  & (P extends typeof utilizationV1 ? { readonly fields: Declaration<P['fields'], keyof typeof utilizationV1.fields> } : unknown);
type Distinct<Tuple extends readonly string[], Seen extends string = never> = number extends Tuple['length'] ? never
  : Tuple extends readonly [infer First extends string, ...infer Rest extends readonly string[]]
    ? First extends Seen ? never : Distinct<Rest, Seen | First>
    : unknown;

/** Declare a fixed read with a closed, nonempty scalar row. */
export function defineRead<const Id extends Versioned, const D extends { readonly row: Fields }>(
  id: Id, definition: D & Declaration<NoInfer<D>, 'row'> & { readonly row: Row<NoInfer<D['row']>> },
): { readonly id: Id; readonly row: D['row'] } {
  return { id, row: definition.row };
}

type CheckedDefinition<D extends Definition, Extra extends PropertyKey = never> = Declaration<D, Extra | keyof Extract<Definition, { readonly kind: D['kind'] }>>
  & { readonly fields: ClosedMap<D['fields']> }
  & (D extends { readonly schema: infer S } ? { readonly schema: Declaration<S, keyof FactSchema> } : unknown)
  & (D extends { readonly optional: infer O extends readonly string[] }
    ? { readonly optional: readonly Key<D['fields']>[] } & Distinct<O> : unknown)
  & (D extends { readonly read: infer R extends ReadRef }
    ? { readonly read: Declaration<R, keyof ReadRef> & { readonly row: Row<R['row']> } } : unknown);

export function defineProtocol<const Id extends Versioned, const D extends Definition>(
  id: Id, definition: D & CheckedDefinition<NoInfer<D>>,
): D & { readonly id: Id; readonly published: false } {
  return { ...definition, id, published: false };
}

type SidebarCheck<P extends Protocol, Placement extends string> = 'sidebar' extends Placement
  ? keyof P['fields'] extends never ? 'read' extends keyof P ? never : unknown : never
  : unknown;

export function definePoint<
  const Owner extends string, const Id extends string, const P extends Protocol, const A extends PointOptions<NoInfer<P>>,
>(
  owner: Owner & Literal<NoInfer<Owner>>, id: Id & Literal<NoInfer<Id>>, protocol: P & ConcreteProtocol<NoInfer<P>>,
  options: A & Declaration<NoInfer<A>, keyof PointOptions<NoInfer<P>>> & SidebarCheck<NoInfer<P>, NoInfer<A['placement']>>,
): A & { readonly owner: Owner; readonly id: Id; readonly protocol: P } {
  return { owner, id, protocol, ...options };
}

type OptionalKeys<P extends Protocol> = P extends { readonly optional: readonly (infer K)[] } ? Extract<K, keyof P['fields']> : never;
type Context<P extends Protocol> = Omit<Values<P['fields']>, OptionalKeys<P>> & Partial<Pick<Values<P['fields']>, OptionalKeys<P>>>;
/** The owner's complete scalar projection; only the declared optional keys can be omitted. */
export type PointContext<T extends PointRef> = Context<T['protocol']>;

type ConcretePoint<T extends PointRef> = {
  readonly owner: Literal<T['owner']>;
  readonly id: Literal<T['id']>;
  readonly protocol: ConcreteProtocol<T['protocol']>;
};
type OutletBuilder<Base extends PointRef> = <const T extends Base, const C extends PointContext<NoInfer<T>> & object>(
  point: T & CheckedPoint<NoInfer<T>>,
  context: Only<C, keyof PointContext<NoInfer<T>>> & (C extends (...args: never[]) => unknown ? never : unknown),
) => { readonly point: T['id']; readonly context: Readonly<C> };

function place<T extends PointRef, C extends object>(point: T, context: C): { readonly point: T['id']; readonly context: Readonly<C> } {
  return { point: point.id, context };
}

export const outlet: OutletBuilder<PointRef<ProtocolOf<'section'>>> = place;
export const tabOutlet: OutletBuilder<PointRef<ProtocolOf<'view'>> & { readonly placement: 'detail-tab' }> = place;
export const menuOutlet: OutletBuilder<PointRef<ProtocolOf<'menu'>>> = place;

type NonEmpty<T> = readonly [T, ...T[]];
type OneToFour<T> = readonly [T] | readonly [T, T] | readonly [T, T, T] | readonly [T, T, T, T];
type Match<F extends Fields, Requested extends Key<F>> = {
  [N in Requested]: { readonly field: N; readonly equals: Scalar<F[N]> }
}[Requested];
type Target<P extends Protocol, K extends Key<P['fields']>> = PointRef<P>
  | (P['kind'] extends 'view' | 'menu' ? {
    readonly point: PointRef<P> & { readonly placement: 'detail-tab' | 'context-menu' };
    readonly when: OneToFour<Match<P['fields'], K>>;
  } : never);
type MenuAction = { readonly kind: 'info' } | { readonly kind: 'openView'; readonly point: PointRef<ProtocolOf<'view'>>; readonly offer: string };
type Options<P extends Protocol> = {
  readonly label: string;
  readonly requests: readonly Key<P['fields']>[];
  readonly targets: NonEmpty<Target<P, Key<P['fields']>>>;
} & (P extends ProtocolOf<'menu'> ? { readonly action: MenuAction }
  : P extends ProtocolOf<'view'> ? { readonly requestRead?: P extends { readonly read: ReadRef } ? true : never }
  : unknown);

type CheckedPoint<T extends PointRef> = ConcretePoint<T> & SidebarCheck<T['protocol'], T['placement']>
  & Declaration<T, 'id' | 'owner' | 'protocol' | keyof PointOptions<T['protocol']>>;
type Conditions<W extends readonly unknown[]> = { readonly [I in keyof W]: Declaration<W[I], 'field' | 'equals'> };
type MatchFields<W extends readonly unknown[]> = { [I in keyof W]: W[I] extends { readonly field: infer K extends string } ? K : never };
type BoundPoint<P extends Protocol, T extends PointRef> = P extends T['protocol'] ? CheckedPoint<T> : never;
type CheckedTarget<P extends Protocol, T> = T extends { readonly point: infer Ref extends PointRef; readonly when: infer W extends readonly unknown[] }
  ? Declaration<T, 'point' | 'when'> & { readonly point: BoundPoint<P, Ref>; readonly when: Conditions<W> } & Distinct<MatchFields<W>>
  : T extends PointRef ? BoundPoint<P, T> : never;
type CheckedAction<A> = A extends { readonly kind: 'openView'; readonly point: infer Ref extends PointRef }
  ? Declaration<A, 'kind' | 'offer' | 'point'> & { readonly point: CheckedPoint<Ref> }
  : Declaration<A, 'kind'>;
type RequestTargets = { readonly requests: readonly string[]; readonly targets: readonly unknown[] };
type CheckedTargets<P extends Protocol, K extends Key<P['fields']>, Targets extends readonly unknown[]> = {
  readonly [I in keyof Targets]: Target<P, K> & CheckedTarget<P, Targets[I]>
};
// Infer the offer first. Its predicates can use its requested keys, never add to them through inference.
type CheckOptions<P extends Protocol, A extends RequestTargets> = Distinct<A['requests']> & {
  readonly targets: CheckedTargets<P, Extract<A['requests'][number], Key<P['fields']>>, A['targets']>;
} & (A extends { readonly action: infer Action } ? { readonly action: CheckedAction<Action> } : unknown);
type OfferBuilder<Base extends Protocol> = <const P extends Base, const A extends Options<NoInfer<P>>>(
  protocol: P & ConcreteProtocol<NoInfer<P>>,
  options: A & Declaration<NoInfer<A>, keyof Options<NoInfer<P>>> & CheckOptions<NoInfer<P>, NoInfer<A>>,
) => A & { readonly protocol: P };

function offer<P extends Protocol, A extends object>(protocol: P, options: A): A & { readonly protocol: P } {
  return { protocol, ...options };
}

export const defineOffer: OfferBuilder<ProtocolOf<'section'>> = offer;
export const defineViewOffer: OfferBuilder<ProtocolOf<'view'>> = offer;
export const defineMenuOffer: OfferBuilder<ProtocolOf<'menu'>> = offer;

type Offer = RequestTargets & { readonly label: string; readonly protocol: Protocol };
type Offers = Readonly<Record<string, Offer>>;
type Plugin = { readonly id: string; readonly points?: readonly PointRef[]; readonly offers?: Offers };
type ViewKeys<R extends Offers> = { [K in keyof R]: R[K]['protocol']['kind'] extends 'view' ? K : never }[keyof R];
// openView is local to this descriptor. The build checks the destination point and owner against the actual bindings.
type PluginOffers<R extends Offers> = ClosedMap<R> & {
  readonly [K in keyof R]: Declaration<R[K], 'protocol' | keyof Options<R[K]['protocol']>>
    & Options<R[K]['protocol']> & CheckOptions<R[K]['protocol'], R[K]>
    & (R[K] extends { readonly action: { readonly kind: 'openView' } } ? { readonly action: { readonly offer: ViewKeys<R> } } : unknown)
};
type PluginPoints<Id extends string, T extends readonly PointRef[]> = { readonly [I in keyof T]: CheckedPoint<T[I]> & { readonly owner: Id } };
type CheckPlugin<D extends Plugin> = { readonly id: Literal<D['id']> }
  & (D extends { readonly points: infer T extends readonly PointRef[] } ? { readonly points: PluginPoints<D['id'], T> } : unknown)
  & (D extends { readonly offers: infer R extends Offers } ? { readonly offers: PluginOffers<R> } : unknown);

export function definePlugin<const D extends Plugin>(descriptor: D & Declaration<NoInfer<D>, keyof Plugin> & CheckPlugin<NoInfer<D>>): D {
  return descriptor;
}

/** The host can grant any subset of the requested fields. A match does not make a prop required. */
export type OfferInput<O extends Offer> = Partial<Pick<Values<O['protocol']['fields']>, Extract<O['requests'][number], keyof O['protocol']['fields']>>>;
/** Only scalar features return data. Views mount as components; openView has no executable export. */
export type OfferResult<O extends Offer> = O extends { readonly protocol: { readonly kind: 'section' } } ? Values<FactSchema>
  : O extends { readonly protocol: { readonly kind: 'menu' }; readonly action: { readonly kind: 'info' } } ? { readonly text: string }
  : never;

type Related<F extends Fields> = { readonly state: 'unavailable' | 'loading' | 'failed' } | {
  readonly state: 'ready';
  readonly rows: readonly Values<F>[];
  readonly coverage: 'complete' | 'partial';
  readonly truncated: boolean;
};
/** Props of a synchronous mounted Body. A scalar-only view has no related member. */
export type ViewProps<O extends Offer> = O extends { readonly protocol: { readonly kind: 'view' } }
  ? { readonly input: OfferInput<O> } & (
    O extends { readonly requestRead: true; readonly protocol: { readonly read: { readonly row: infer F extends Fields } } }
      ? { readonly related: Related<F> } : unknown
  ) : never;
