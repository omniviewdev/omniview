import { equalJson, isPlainObject, stableJson, strictJson } from './json';
import type { Json, Params, Route } from './types';

// A route is a plugin, one of the pages it offers, and that page's parameters: the plugin-agnostic key of a tab. It is canonical (keys in order, a member
// that says nothing left out), frozen, and equal to another route by what it holds, never by how it was written.

/** A parameter that is absent, null or empty names nothing: `{ item: '' }` and `{}` are one route. */
const says = (value: Json | undefined): value is Json => value !== undefined && value !== null && value !== '';

/** The route of `input`, or `undefined` when it is not valid data: a plugin and a page that are text, parameters that are plain JSON. */
export function normaliseRoute(input: unknown): Route | undefined {
  if (!isPlainObject(input)) {
    return undefined;
  }

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

export function sameRoute(a: Route, b: Route): boolean {
  return a === b || (a.plugin === b.plugin && a.contribution === b.contribution && equalJson(a.params, b.params));
}

/** The text of a route's parameters, empty when there are none: a key does not depend on the order they were written in. */
export const paramsText = (params: Params): string => (Object.keys(params).length === 0 ? '' : stableJson(params));

/** True when `want` names a parameter that `shown` does not hold equal: a request that asks for more than the page already shows (ch16 K1). */
export function routeSays(want: Route, shown: Route): boolean {
  return Object.entries(want.params).some(([key, value]) => !equalJson(value, shown.params[key]));
}
