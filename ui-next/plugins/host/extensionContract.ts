import { decodeExtensionManifest, type ExtensionEdge, type ExtensionOffer, type ExtensionPoint } from '@omniviewdev/runtime/internal/extensions-v1';
import { utilizationV1 } from '@omniviewdev/runtime/ui/extensions/v1';

export type { ExtensionEdge, ExtensionOffer, ExtensionPoint } from '@omniviewdev/runtime/internal/extensions-v1';
export type ExtensionFields = Readonly<Record<string, 'string' | 'number'>>;

/** Only the native inventory adapter constructs these rows. A pin string alone is not evidence of installation or trust. */
export type ExtensionSource = {
  readonly id: string;
  readonly pin: string;
  readonly generation: string;
  readonly manifest: string;
  readonly features: readonly string[];
  readonly views: readonly string[];
  readonly ordinaryReady: boolean;
};

export type DeclaredExtensionPoint = {
  readonly point: string;
  readonly declaration: ExtensionPoint;
  readonly ownerPin: string;
  readonly sourceGeneration: string;
  readonly contract: string;
  /** The digest an operator may separately approve, not permission to read. */
  readonly read?: string;
};

type Protocol = {
  readonly key: string;
  readonly fields: ExtensionFields;
  readonly optional: readonly string[];
  readonly read: string | undefined;
};
export type PreparedPoint = { readonly info: DeclaredExtensionPoint; readonly protocol: Protocol };
export type PreparedEdge = { readonly name: string; readonly offer: ExtensionOffer; readonly edge: ExtensionEdge; readonly protocol: Protocol };
export type PreparedSource = { readonly points: readonly PreparedPoint[]; readonly edges: readonly PreparedEdge[] };

// The bounded canonical decoder built this tree; none of its objects can trap enumeration or property access.
function freezeManifest(value: unknown): void {
  if (value !== null && typeof value === 'object') {
    for (const key of Object.keys(value)) {
      freezeManifest(Reflect.get(value, key));
    }

    Object.freeze(value);
  }
}

export function sameNames(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((name, i) => name === right[i]);
}

function pairs(fields: ExtensionFields) {
  return Object.keys(fields).sort().map(name => [name, fields[name]] as const);
}

function protocolOf(definition: ExtensionPoint | ExtensionOffer): Protocol {
  // The decoder permits an omitted definition only for the SDK publication and forbids overriding its fields or result.
  const fields = definition.fields ?? utilizationV1.fields;
  const optional = definition.kind === 'section' ? [] : [...definition.optional ?? []].sort();
  const schema = definition.kind === 'section' ? pairs(definition.schema ?? utilizationV1.schema) : null;
  const read = definition.kind === 'view' && definition.read ? [definition.read.id, pairs(definition.read.row)] : null;
  return {
    key: JSON.stringify([definition.protocol, definition.kind, pairs(fields), optional, schema, read]),
    fields, optional, read: read === null ? undefined : JSON.stringify(read),
  };
}

async function sha256(text: string): Promise<string> {
  const hash = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
}

/** Never opens an asset. The native side has statically inspected the fixed pinned roles; check their exact exports here. */
export async function prepareExtensionSource(source: ExtensionSource): Promise<PreparedSource> {
  const manifest = decodeExtensionManifest(source.id, source.manifest);
  const features: string[] = [];
  const views: string[] = [];
  const offers = new Map<string, ExtensionOffer>();
  for (const offer of manifest.offers) {
    offers.set(offer.id, offer);
    if (offer.kind === 'view') {
      views.push(offer.id);
    } else if (offer.kind === 'section' || offer.action.kind === 'info') {
      features.push(offer.id);
    }
  }

  if (!sameNames(features.sort(), source.features) || !sameNames(views.sort(), source.views)) {
    throw new Error('Extension asset exports do not match the manifest');
  }

  freezeManifest(manifest);
  // The decoder proved one definition per protocol within this source. Compare the full canonical key across sources.
  const definitions = new Map<string, Protocol>();
  function protocol(definition: ExtensionPoint | ExtensionOffer): Protocol {
    let result = definitions.get(definition.protocol);
    if (!result) {
      definitions.set(definition.protocol, result = protocolOf(definition));
    }

    return result;
  }

  const hashes = new Map<string, Promise<string>>();
  async function digest(text: string) {
    let hash = hashes.get(text);
    if (!hash) {
      hashes.set(text, hash = sha256(text));
    }

    return hash;
  }

  const edges = manifest.bindings.map(edge => {
    const offer = offers.get(edge.offer)!; // The canonical decoder resolved every local offer.
    return { name: `${source.id}/${offer.id}`, offer, edge, protocol: protocol(offer) };
  });
  const points = await Promise.all(manifest.points.map(async declaration => {
    const p = protocol(declaration);
    // Compact UTF-8 JSON [placement, ...protocolDefinition]. Reading the same protocol from two points does not hash it twice.
    const contractText = `[${JSON.stringify(declaration.placement)},${p.key.slice(1)}`;
    const [contract, read] = await Promise.all([digest(contractText), p.read === undefined ? undefined : digest(p.read)]);
    const info = Object.freeze({ point: `${source.id}/${declaration.id}`, declaration, ownerPin: source.pin,
      sourceGeneration: source.generation, contract, ...(read === undefined ? {} : { read }) });
    return { info, protocol: p };
  }));
  return { points, edges };
}
