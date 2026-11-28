import { isExtensionIdSegment, isExtensionOwnerId } from '@omniviewdev/runtime/internal/extensions-v1';
import { equalJson, fitsUtf8, isPlainObject, stableJson, strictJson } from './json';
import type { ExtensionViewRoute, Json, Params, Route, TabRoute } from './types';

// A route is a plugin, one of the pages it offers, and that page's parameters: the plugin-agnostic key of a tab. It is canonical (keys in order, a member
// that says nothing left out), frozen, and equal to another route by what it holds, never by how it was written.

/** A parameter that is absent, null or empty names nothing: `{ item: '' }` and `{}` are one route. */
const says = (value: Json | undefined): value is Json => value !== undefined && value !== null && value !== '';

/** Plugin-facing APIs can supply only ordinary pages, never a tagged host location. */
export function normaliseRoute(input: unknown): Route | undefined {
  return isPlainObject(input) && input.kind === undefined ? pageRoute(input) : undefined;
}

function pageRoute(input: Record<string, unknown>): Route | undefined {
  const { plugin, contribution, params } = input;
  if (typeof plugin !== 'string' || typeof contribution !== 'string' || plugin.trim() === '' || contribution.trim() === '') {
    return undefined;
  }

  const shown: Record<string, unknown> = {};
  if (params !== undefined) {
    if (!isPlainObject(params)) {
      return undefined;
    }

    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) {
        shown[key] = value;
      }
    }
  }

  const copy = strictJson(shown);
  if (copy === undefined || copy === null || typeof copy !== 'object' || Array.isArray(copy)) {
    return undefined;
  }

  const kept: Record<string, Json> = {};
  for (const [key, value] of Object.entries(copy)) {
    if (says(value)) {
      kept[key] = value;
    }
  }

  return Object.freeze({ plugin: plugin.trim(), contribution: contribution.trim(), params: Object.freeze(kept) });
}

const VIEW_MEMBERS: Record<keyof ExtensionViewRoute, true> = { kind: true, plugin: true, point: true, offer: true, connection: true };
const CONNECTION_BYTES = 2 * 1024;

/** The closed locator accepted in history, saved tabs, transfers and hashes. Never carry arbitrary props across this boundary. */
export function normaliseExtensionView(input: unknown): ExtensionViewRoute | undefined {
  if (!isPlainObject(input) || input.kind !== 'extension-view') {
    return undefined;
  }

  for (const key in input) {
    if (!Object.hasOwn(VIEW_MEMBERS, key)) {
      return undefined;
    }
  }

  const { plugin, point, offer, connection } = input;
  if (!isExtensionOwnerId(plugin) || !isExtensionIdSegment(point) || typeof offer !== 'string' || offer.length > 257) {
    return undefined;
  }

  const slash = offer.indexOf('/');
  if (slash < 1 || !isExtensionOwnerId(offer.slice(0, slash)) || !isExtensionIdSegment(offer.slice(slash + 1))) {
    return undefined;
  }

  if (connection !== undefined && (typeof connection !== 'string' || connection === '' || !fitsUtf8(connection, CONNECTION_BYTES))) {
    return undefined;
  }

  return Object.freeze({ kind: 'extension-view', plugin, point, offer, ...(connection === undefined ? {} : { connection }) });
}

export function normaliseTabRoute(input: unknown): TabRoute | undefined {
  if (!isPlainObject(input)) {
    return undefined;
  }

  return input.kind === undefined ? pageRoute(input) : normaliseExtensionView(input);
}

export function sameRoute(a: TabRoute, b: TabRoute): boolean {
  if (a === b) {
    return true;
  }

  if (a.plugin !== b.plugin) {
    return false;
  }

  if (a.kind === 'extension-view') {
    return b.kind === a.kind && a.point === b.point && a.offer === b.offer && a.connection === b.connection;
  }

  return b.kind === undefined && a.contribution === b.contribution && equalJson(a.params, b.params);
}

/** The text of a route's parameters, empty when there are none: a key does not depend on the order they were written in. */
export const paramsText = (params: Params): string => (Object.keys(params).length === 0 ? '' : stableJson(params));

/** True when `want` names a parameter that `shown` does not hold equal: a request that asks for more than the page already shows (ch16 K1). */
export function routeSays(want: Route, shown: Route): boolean {
  return Object.entries(want.params).some(([key, value]) => !equalJson(value, shown.params[key]));
}
