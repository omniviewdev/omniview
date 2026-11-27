import { decodeExtensionManifest } from '@omniviewdev/runtime/internal/extensions-v1';
import { utilizationV1 } from '@omniviewdev/runtime/ui/extensions/v1';
import { closed, equal, fail, list, object, text, type Data, type DataObject, type Role } from './data';
import type { StaticGraph } from './static';

/** Shared consts form a DAG. Stop an oversized expansion before JSON.stringify materializes it.
 * These are lower bounds; the canonical decoder still checks the exact encoded bytes. */
function wireJSON(value: DataObject): string {
  let nodes = 0, bytes = 0;
  return JSON.stringify(value, function (key: string, item: Data) {
    if (!Array.isArray(this)) {
      bytes += Buffer.byteLength(key);
    }

    if (typeof item === 'string') {
      bytes += Buffer.byteLength(item);
    }

    if (++nodes > 256 * 1024 || bytes > 256 * 1024) {
      fail('manifest exceeds 256 KiB');
    }

    return item;
  });
}

function protocol(value: Data): DataObject {
  const p = object(value, 'protocol');
  closed(p, 'protocol', ['id', 'kind', 'published', 'fields', 'schema', 'optional', 'read']);
  const { id, kind, published, ...definition } = p;
  if (published === true) {
    if (!equal(p, utilizationV1)) {
      fail('protocol: unknown SDK publication');
    }

    return { protocol: id, kind };
  }

  if (published !== false) {
    fail('protocol: expected a private definition or SDK publication');
  }

  if (definition.optional !== undefined && !list(definition.optional, 'protocol.optional').length) {
    delete definition.optional;
  }

  return { protocol: id, kind, ...definition };
}

function comparable(p: DataObject): DataObject {
  return Array.isArray(p.optional) ? { ...p, optional: [...p.optional].sort() } : p;
}

/** Lower only proven point references. The canonical decoder validates external point definitions too:
 * their placement and authority never come from a contributor's guess about a qualified ID. */
export function compileManifest(installedId: string, descriptor: DataObject, graph: StaticGraph): { json: string; roles: Role[] } {
  closed(descriptor, 'plugin', ['id', 'points', 'offers']);
  if (descriptor.id !== installedId) {
    fail('plugin.id must match plugin.yaml');
  }

  const points: DataObject[] = [], offers: DataObject[] = [], bindings: DataObject[] = [];
  const verified = new WeakMap<DataObject, DataObject>();
  const definitions = new Map<string, DataObject>();

  function point(value: Data): { ref: string; wire: DataObject; shape: DataObject } {
    const p = object(value, 'point');
    const locator = graph.locators.get(p);
    if (!locator) {
      fail('point: expected the actual named export of a pinned public contract package');
    }

    const owner = text(p.owner, 'point.owner'), ref = `${owner}/${text(p.id, 'point.id')}`;
    const shape = protocol(p.protocol);
    let wire = verified.get(p);
    if (!wire) {
      closed(p, 'point', ['id', 'owner', 'protocol', 'label', 'placement', 'warmOnPage']);
      const { owner: _owner, protocol: _protocol, ...options } = p;
      wire = { ...options, ...shape, contract: { ...locator } };
      decodeExtensionManifest(owner, wireJSON({ schemaVersion: 1, id: owner, points: [wire], offers: [], bindings: [] }));
      const contract = { placement: p.placement, ...comparable(shape) };
      const previous = definitions.get(ref);
      if (previous && !equal(previous, contract)) {
        fail('target: conflicting definitions of the same published point');
      }

      definitions.set(ref, contract);
      verified.set(p, wire);
    }

    return { ref, wire, shape };
  }

  for (const imported of graph.importedPoints) {
    point(imported);
  }

  if (Object.hasOwn(descriptor, 'points')) {
    for (const value of list(descriptor.points, 'points')) {
      if (object(value, 'point').owner !== installedId) {
        fail('points: cannot publish another owner’s point');
      }

      points.push(point(value).wire);
    }
  }

  const declared = Object.hasOwn(descriptor, 'offers') ? object(descriptor.offers, 'offers') : {};
  for (const [id, value] of Object.entries(declared)) {
    const offer = object(value, 'offer');
    const shape = protocol(offer.protocol);
    const { targets, protocol: _protocol, action, ...options } = offer;
    const expected = shape.kind === 'section' ? 'defineOffer' : shape.kind === 'view' ? 'defineViewOffer' : 'defineMenuOffer';
    if (graph.built.get(offer) !== expected) {
      fail(`offer: expected ${expected} for this protocol`);
    }

    closed(offer, 'offer', ['protocol', 'targets', 'label', 'requests', 'requestRead', 'action']);
    const wire: DataObject = { id, ...options, ...shape };
    if (action !== undefined) {
      const a = object(action, 'offer.action');
      if (a.kind === 'openView') {
        const dest = point(a.point);
        if (dest.shape.kind !== 'view') {
          fail('action.point: expected a published view point');
        }

        wire.action = { ...a, point: dest.ref };
      } else {
        wire.action = a;
      }
    }

    for (const item of list(targets, 'targets')) {
      const target = object(item, 'target');
      const wrapper = Object.hasOwn(target, 'point');
      if (wrapper) {
        closed(target, 'target', ['point', 'when']);
        if (!Object.hasOwn(target, 'when')) {
          fail('target.when: expected a literal conjunction');
        }
      }

      const p = point(wrapper ? target.point : target);
      if (!equal(comparable(p.shape), comparable(shape))) {
        fail('target.protocol must match the complete offer protocol');
      }

      if (wrapper && p.wire.placement !== 'detail-tab' && p.wire.placement !== 'context-menu') {
        fail('target.when requires a menu or detail-tab point');
      }

      bindings.push({ offer: id, target: p.ref, ...(wrapper ? { when: target.when } : {}) });
    }

    offers.push(wire);
  }

  const json = wireJSON({ schemaVersion: 1, id: installedId, points, offers, bindings });
  const manifest = decodeExtensionManifest(installedId, json);
  const features: Role = { source: 'features.ts', asset: 'extensions.js', names: [] };
  const views: Role = { source: 'views.tsx', asset: 'views.js', names: [] };
  for (const offer of manifest.offers) {
    if (offer.kind === 'view') {
      views.names.push(offer.id);
    }

    if (offer.kind === 'section' || offer.kind === 'menu' && offer.action?.kind === 'info') {
      features.names.push(offer.id);
    }
  }

  return { json, roles: [features, views].filter(role => role.names.length > 0) };
}
