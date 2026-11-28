// Type-check only. These local values exercise the SDK's declarations, not the packager's package-provenance checks.
import {
  defineMenuOffer, defineOffer, definePlugin, definePoint, defineProtocol, defineRead, defineViewOffer,
  menuOutlet, outlet, tabOutlet, utilizationV1,
  type OfferInput, type OfferResult, type PointContext, type PointRef, type ViewProps,
} from '../../src/ui/extensions/v1.js';

const facts = { fields: { kind: 'string', count: 'number' }, optional: ['count'] } as const;
const menu = definePoint('owner', 'actions', defineProtocol('owner/actions@1', { kind: 'menu', ...facts }), {
  placement: 'context-menu', label: 'Actions',
});
const tabs = definePoint('owner', 'tabs', defineProtocol('owner/tabs@1', { kind: 'view', ...facts }), {
  placement: 'detail-tab', label: 'Detail tabs',
});
const sidebar = definePoint('owner', 'tools', defineProtocol('owner/tools@1', { kind: 'view', fields: {} }), {
  placement: 'sidebar', label: 'Tools',
});
const read = defineRead('owner/neighbors@1', { row: { name: 'string', weight: 'number' } });
const neighbors = definePoint('owner', 'neighbors', defineProtocol('owner/neighbors@1', { kind: 'view', fields: {}, read }), {
  placement: 'detail-tab', label: 'Neighbors',
});
const section = definePoint('owner', 'usage', utilizationV1, { placement: 'overview-section', label: 'Usage', warmOnPage: 'overview' });
const privateFact = defineProtocol('owner/fact@1', { kind: 'section', fields: { name: 'string' }, schema: { label: 'string', value: 'string' } });
const privateSection = definePoint('owner', 'fact', privateFact, { placement: 'overview-section', label: 'Fact' });

definePlugin({ id: 'owner', points: [menu, tabs, sidebar, neighbors, section, privateSection] });
const tool = defineViewOffer(sidebar.protocol, { label: 'Open tool', requests: [], targets: [sidebar] });
const inspected = defineViewOffer(tabs.protocol, {
  label: 'Inspect', requests: ['count'], targets: [{ point: tabs, when: [{ field: 'count', equals: 0 }] }],
});
const related = defineViewOffer(neighbors.protocol, { label: 'Related', requests: [], targets: [neighbors], requestRead: true });
const withoutRead = defineViewOffer(neighbors.protocol, { label: 'Static', requests: [], targets: [neighbors] });
const menuOpts = {
  label: 'Action', requests: ['kind', 'count'], targets: [{ point: menu, when: [{ field: 'kind', equals: '' }, { field: 'count', equals: 1 }] }],
} as const;
const info = defineMenuOffer(menu.protocol, { ...menuOpts, action: { kind: 'info' } });
const open = defineMenuOffer(menu.protocol, { ...menuOpts, action: { kind: 'openView', point: sidebar, offer: 'open-tool' } });
const usage = defineOffer(section.protocol, { label: 'Usage', requests: ['used', 'capacity'], targets: [section] });
const fact = defineOffer(privateFact, { label: 'Fact', requests: ['name'], targets: [privateSection] });
const plugin = definePlugin({ id: 'peer', offers: { 'open-tool': tool, inspected, related, withoutRead, info, open, usage, fact } });

// Identity, projections and result props must survive all the way through the default descriptor.
type Same<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Assert<T extends true> = T;
type Shape<T> = { [K in keyof T]: T[K] };
type Peer = typeof plugin.offers;
export type ContractChecks = [
  Assert<Same<typeof tabs.id, 'tabs'>>,
  Assert<Same<Shape<PointContext<typeof tabs>>, { readonly kind: string; readonly count?: number }>>,
  Assert<Same<OfferInput<Peer['inspected']>, { readonly count?: number }>>,
  Assert<Same<OfferResult<Peer['usage']>, { readonly label: string; readonly value: string }>>,
  Assert<Same<OfferResult<Peer['info']>, { readonly text: string }>>,
  Assert<Same<OfferResult<Peer['inspected']>, never>>,
  Assert<Same<OfferResult<Peer['open']>, never>>,
  Assert<Same<ViewProps<Peer['info']>, never>>,
  Assert<Same<keyof ViewProps<Peer['open-tool']>, 'input'>>,
  Assert<Same<keyof ViewProps<Peer['open-tool']>['input'], never>>,
  Assert<Same<keyof ViewProps<Peer['withoutRead']>, 'input'>>,
  Assert<Same<keyof ViewProps<Peer['related']>, 'input' | 'related'>>,
  Assert<Same<Extract<ViewProps<Peer['related']>['related'], { state: 'ready' }>['rows'][number], { readonly name: string; readonly weight: number }>>,
];

export const factFeature = (input: OfferInput<Peer['usage']>): OfferResult<Peer['usage']> => ({ label: 'Used', value: String(input.used ?? 'Unavailable') });
export const infoFeature = (input: OfferInput<Peer['info']>): OfferResult<Peer['info']> => ({ text: input.kind ?? 'Unknown' });
export function presentation({ related: answer }: ViewProps<Peer['related']>) {
  if (answer.state === 'ready') return answer.rows.map((row) => row.name);
  // @ts-expect-error Data is absent while unavailable, loading or failed.
  return answer.rows;
}

const ownerValues = { kind: 'Job', count: 0 };
menuOutlet(menu, ownerValues);
tabOutlet(tabs, { kind: 'Job' });
outlet(section, { used: 0, capacity: 12 });
tabOutlet(neighbors, {});
// @ts-expect-error A menu cannot fill a tab strip.
tabOutlet(menu, ownerValues);
// @ts-expect-error A sidebar takes no live outlet or context.
tabOutlet(sidebar, {});
// @ts-expect-error Required owner fields must be present.
menuOutlet(menu, { count: 2 });
// @ts-expect-error The data must have its declared scalar type.
tabOutlet(tabs, { kind: 'Job', count: '2' });
const extraContext = { ...ownerValues, connection: 'west' };
// @ts-expect-error Previously assigned variables do not bypass the exact-key check.
tabOutlet(tabs, extraContext);
// @ts-expect-error A fieldless point does not accept arbitrary keys.
tabOutlet(neighbors, extraContext);
export function erased(point: PointRef) {
  // @ts-expect-error A widened point cannot establish a detail outlet contract.
  return tabOutlet(point, {});
}

const extraDefinition = { kind: 'menu', fields: {}, warmOnPage: 'overview' } as const;
// @ts-expect-error Definitions are closed even through a variable.
defineProtocol('owner/extra@1', extraDefinition);
const openMap: Readonly<Record<string, 'string'>> = { name: 'string' };
// @ts-expect-error Index signatures erase the contract's keys.
defineProtocol('owner/wide@1', { kind: 'view', fields: openMap });
// @ts-expect-error A fixed read must have at least one row key.
defineRead('owner/empty@1', { row: {} });
// @ts-expect-error Row schemas are scalar tag maps, not examples.
defineRead('owner/wrong-row@1', { row: { x: 123 } });
const extraRead = { row: { x: 'string' }, query: 'all' } as const;
// @ts-expect-error Reads have no query member.
defineRead('owner/query@1', extraRead);
// @ts-expect-error A menu may not declare a read.
defineProtocol('owner/menu-read@1', { kind: 'menu', fields: {}, read });
const extraSchema = { label: 'string', value: 'string', hint: 'string' } as const;
// @ts-expect-error Section results have exactly two string tags.
defineProtocol('owner/schema@1', { kind: 'section', fields: {}, schema: extraSchema });
// @ts-expect-error Optional keys must be declared fields.
defineProtocol('owner/option@1', { kind: 'view', fields: { kind: 'string' }, optional: ['count'] });
// @ts-expect-error A key cannot be optional twice.
defineProtocol('owner/repeated@1', { kind: 'menu', fields: { name: 'string' }, optional: ['name', 'name'] });
// @ts-expect-error Menus have one placement.
definePoint('owner', 'wrong-place', menu.protocol, { placement: 'detail-tab', label: 'Tabs' });
// @ts-expect-error Sidebar views must be fieldless.
definePoint('owner', 'wrong-sidebar', tabs.protocol, { placement: 'sidebar', label: 'Tools' });
// @ts-expect-error Sidebar views cannot have related reads.
definePoint('owner', 'read-sidebar', neighbors.protocol, { placement: 'sidebar', label: 'Tools' });
const extraPointOpts = { placement: 'detail-tab', label: 'Tabs', warmOnPage: 'overview' } as const;
// @ts-expect-error A warm hint is section-only, even via a variable.
definePoint('owner', 'warm-tab', tabs.protocol, extraPointOpts);

const viewOpts = { label: 'View', requests: ['kind'], targets: [tabs] } as const;
// @ts-expect-error Offers use the builder for their protocol's kind.
defineOffer(tabs.protocol, viewOpts);
// @ts-expect-error A request cannot widen the protocol's fields.
defineViewOffer(tabs.protocol, { ...viewOpts, requests: ['uid'] });
// @ts-expect-error Empty target lists do not create an implicit binding.
defineViewOffer(tabs.protocol, { ...viewOpts, targets: [] });
// @ts-expect-error Different view protocol IDs do not match structurally.
defineViewOffer(tabs.protocol, { ...viewOpts, targets: [neighbors] });
// @ts-expect-error A protocol without a read cannot promise related props.
defineViewOffer(tabs.protocol, { ...viewOpts, requestRead: true });
const extraOffer = { ...viewOpts, callback: () => 'secret' };
// @ts-expect-error Options have no callback, even via a variable.
defineViewOffer(tabs.protocol, extraOffer);
const byCount = { point: tabs, when: [{ field: 'count', equals: 0 }] } as const;
// @ts-expect-error A predicate cannot widen requests from kind to count.
defineViewOffer(tabs.protocol, { ...viewOpts, targets: [byCount] });
// @ts-expect-error Section targets have no condition.
defineOffer(section.protocol, { label: 'Usage', requests: ['used'], targets: [{ point: section, when: [{ field: 'used', equals: 0 }] }] });
// @ts-expect-error Sidebar targets cannot be conditional.
defineViewOffer(sidebar.protocol, { label: 'Tool', requests: [], targets: [{ point: sidebar, when: [] }] });
// @ts-expect-error Match values must have the compared field's type.
defineMenuOffer(menu.protocol, { ...menuOpts, action: { kind: 'info' }, targets: [{ point: menu, when: [{ field: 'count', equals: '' }] }] });
const extraMatch = { field: 'kind', equals: 'Job', flags: 'i' } as const;
// @ts-expect-error Match records are closed, including preassigned records.
defineViewOffer(tabs.protocol, { ...viewOpts, targets: [{ point: tabs, when: [extraMatch] }] });
const extraTarget = { point: tabs, when: [{ field: 'kind', equals: 'Job' }], or: [] } as const;
// @ts-expect-error Target wrappers have no disjunction field.
defineViewOffer(tabs.protocol, { ...viewOpts, targets: [extraTarget] });
const match = { field: 'kind', equals: 'Job' } as const;
// @ts-expect-error One condition cannot compare the same field twice.
defineViewOffer(tabs.protocol, { ...viewOpts, targets: [{ point: tabs, when: [match, match] }] });
// @ts-expect-error A condition is nonempty and bounded at four comparisons.
defineViewOffer(tabs.protocol, { ...viewOpts, targets: [{ point: tabs, when: [match, match, match, match, match] }] });
const extraAction = { kind: 'info', point: sidebar, offer: 'open-tool' } as const;
// @ts-expect-error Info is not an openView action with a different tag.
defineMenuOffer(menu.protocol, { ...menuOpts, action: extraAction });
// @ts-expect-error An openView destination must be a view point.
defineMenuOffer(menu.protocol, { ...menuOpts, action: { kind: 'openView', point: menu, offer: 'open-tool' } });
// @ts-expect-error An openView action names a local view offer, not an info offer.
definePlugin({ id: 'peer', offers: { open, 'open-tool': info } });
// @ts-expect-error An absent local destination offer cannot be opened.
definePlugin({ id: 'peer', offers: { open, inspected } });
// @ts-expect-error The descriptor may not claim another owner's point.
definePlugin({ id: 'peer', points: [tabs] });
const extraPlugin = { id: 'peer', register: () => undefined } as const;
// @ts-expect-error There is no registration hook on a descriptor.
definePlugin(extraPlugin);

// @ts-expect-error A feature must accept every granted subset, not a required field.
export const tooNarrow: typeof infoFeature = (input: { kind: string }) => ({ text: input.kind });
// @ts-expect-error A read-free Body has no related prop at all.
export const leakedRead = (props: ViewProps<typeof withoutRead>) => props.related;
// @ts-expect-error A Body cannot take credentials or require a requested scalar.
export const narrowBody: (props: ViewProps<typeof inspected>) => string = (props: { input: { count: number }; connection: string }) => props.connection;

const extendedProtocol = { ...tabs.protocol, query: 'all' };
// @ts-expect-error Extending a preassigned protocol cannot bypass its closed shape.
definePoint('owner', 'extended', extendedProtocol, { placement: 'detail-tab', label: 'Extended' });
const changedMeaning = defineProtocol('owner/tabs@1', { kind: 'view', fields: { ...facts.fields, revision: 'number' }, optional: ['count'] });
const changedPoint = definePoint('owner', 'changed', changedMeaning, { placement: 'detail-tab', label: 'Incompatible' });
// @ts-expect-error Matching IDs do not compensate for a changed complete protocol definition.
defineViewOffer(tabs.protocol, { ...viewOpts, targets: [changedPoint] });

const many = definePoint('owner', 'many', defineProtocol('owner/many@1', { kind: 'menu', fields: { a: 'string', b: 'number', c: 'string', d: 'number', e: 'string' } }), {
  label: 'Many', placement: 'context-menu',
});
const comparisons = [{ field: 'a', equals: '' }, { field: 'b', equals: 0 }, { field: 'c', equals: 'yes' }, { field: 'd', equals: 2 }] as const;
const bounded = { label: 'Bounded', requests: ['a', 'b', 'c', 'd', 'e'], action: { kind: 'info' } } as const;
defineMenuOffer(many.protocol, { ...bounded, targets: [{ point: many, when: comparisons }] });
// @ts-expect-error Even distinct requested comparisons cannot exceed the conjunction bound.
defineMenuOffer(many.protocol, { ...bounded, targets: [{ point: many, when: [...comparisons, { field: 'e', equals: 'five' }] }] });
