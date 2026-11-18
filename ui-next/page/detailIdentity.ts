import type { DetailPageDefinition } from './detailDefinition';

// What a detail route says about its object, read from its parameters and the page's definition: the object's name, the tab's title and the qualifiers that tell two tabs of one name
// apart (design 16 TI1, DM1). Pure and synchronous, so the tab model can ask before any data is read and before the page's hook has run; the page draws its heading from the same words.

/** A route's parameters. A parameter that is not a string says nothing here: an identity is text. */
export type RouteParams = Readonly<Record<string, unknown>>;

const textOf = (params: RouteParams, key: string): string => {
  const value = params[key];
  return typeof value === 'string' ? value.trim() : '';
};

/** The object's name: the parameter the definition names, or an empty string when the route lacks it. */
export const nameOf = (definition: Pick<DetailPageDefinition, 'identity'>, params: RouteParams): string => textOf(params, definition.identity.name);

/** The tab's title (design 16 TI1): `{name} · {Kind}`, the kind as the platform spells it. A route with no name is the kind alone. */
export function titleOf(definition: Pick<DetailPageDefinition, 'identity' | 'kind'>, params: RouteParams): string {
  const name = nameOf(definition, params);
  return name === '' ? definition.kind : `${name} · ${definition.kind}`;
}

/** The plugin's qualifiers for the tab, most to least preferred: the parameters the definition lists that the route has, each once. */
export function facetsOf(definition: Pick<DetailPageDefinition, 'identity'>, params: RouteParams): readonly string[] {
  const facets = new Set<string>();
  for (const key of definition.identity.facets ?? []) {
    const facet = textOf(params, key);
    if (facet !== '') {
      facets.add(facet);
    }
  }

  return [...facets];
}
