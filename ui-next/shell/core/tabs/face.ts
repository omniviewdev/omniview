import { isObject } from './json';
import { normaliseRoute, paramsText } from './route';
import { LIMITS, type Crumb, type CrumbInput, type Description, type Face, type Route, type Scope } from './types';

// What a plugin says about a route, made into what a tab keeps: every field present, text trimmed, the scope label short (ch16 S10, S17, DM1).

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const clip = (value: string, length: number): string => (value.length > length ? `${value.slice(0, length - 1).trimEnd()}…` : value);

/** The title a route gives itself when its plugin says none: the page's id, as a sentence. */
function titleOf(route: Route): string {
  const leaf = route.contribution.split('/').at(-1) ?? '';
  const words = leaf.replace(/[-_]+/g, ' ').trim();
  return words === '' ? route.plugin : words.charAt(0).toUpperCase() + words.slice(1);
}

function scopeOf(value: unknown): Scope | undefined {
  if (!isObject(value)) {
    return undefined;
  }

  const id = text(value.id) || text(value.label);
  return id === '' ? undefined : Object.freeze({ id, label: clip(text(value.label) || id, LIMITS.scopeLabel) });
}

function crumbOf(input: unknown): Crumb | undefined {
  const label = text(isObject(input) ? input.label : input);
  if (label === '') {
    return undefined;
  }

  const route = isObject(input) ? normaliseRoute(input.route) : undefined;
  return Object.freeze(route ? { label, route } : { label });
}

/** The face of a route from its plugin's description; `undefined` for the description when the plugin said nothing. */
export function faceOf(route: Route, description: Description | undefined): Face {
  const source: Partial<Record<keyof Description, unknown>> = isObject(description) ? description : {};
  const path = Array.isArray(source.path) ? (source.path as readonly CrumbInput[]).map((crumb) => crumbOf(crumb)).filter((crumb): crumb is Crumb => crumb !== undefined) : [];
  const facets = Array.isArray(source.facets) ? [...new Set((source.facets as readonly unknown[]).map(text).filter((facet) => facet !== ''))].slice(0, LIMITS.facets) : [];
  const scope = scopeOf(source.scope);
  const pluginName = text(source.pluginName);
  return Object.freeze({
    title: text(source.title) || titleOf(route),
    icon: text(source.icon),
    ...(scope ? { scope } : {}),
    path: Object.freeze(path),
    facets: Object.freeze(facets),
    pluginName,
    singleton: source.singleton === true,
    identity: source.identity === 'none' ? ('none' as const) : ('key' as const),
  });
}

/**
 * Which place a tab shows (ch16 S26): `{plugin}:{scope}:{page}`. A singleton page is one place whatever its parameters. For any other page the plugin's own `key` says
 * what is identity (a sub-tab is not), and without one the contribution and its parameters do.
 */
export function keyOf(route: Route, description: Description | undefined, face: Face): string {
  if (face.singleton) {
    return `${route.plugin}:${route.contribution}`;
  }

  const own = text(isObject(description) ? description.key : undefined);
  const page = own === '' ? `${route.contribution}${paramsText(route.params) === '' ? '' : `?${paramsText(route.params)}`}` : own;
  return face.scope ? `${route.plugin}:${face.scope.id}:${page}` : `${route.plugin}:${page}`;
}

/**
 * A face that was saved, read back: the fields that are valid keep their value and the rest take what the route says. Used for a tab whose plugin says nothing yet
 * (it has not loaded), so the strip draws the tab as the user left it.
 */
export function savedFace(value: unknown, route: Route): Face {
  const source: Record<string, unknown> = isObject(value) ? value : {};
  return faceOf(route, {
    title: text(source.title),
    icon: text(source.icon),
    scope: scopeOf(source.scope),
    path: Array.isArray(source.path) ? (source.path as readonly CrumbInput[]) : [],
    facets: Array.isArray(source.facets) ? (source.facets as readonly string[]) : [],
    pluginName: text(source.pluginName),
    singleton: source.singleton === true,
    identity: source.identity === 'none' ? 'none' : undefined,
  });
}
