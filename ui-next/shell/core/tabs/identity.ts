import type { Crumb, Face, Identity, TabId, TabsState } from './types';

// Tab identity (ch16 TI1, S17, S61). A tab is named `{name} · {Kind}` by its plugin. Two open tabs that would read alike (the same icon and title) get a qualifier from the
// host: the shortest facet that tells them all apart, else the first facets joined. The label, the accessible name, the tooltip and the status path all carry it, and
// `identities` is the one place it is computed: no surface builds its own.
//
// `identities` runs once for every change of the strip's tabs or order, and a strip subscribes to it, so its cost per tab is what a change costs. It works out
// what depends on one face once per face object (faces are frozen), and an identity is made again only when its face or its qualifier changed.

/** What `qualify` reads of a tab. `facets` is the plugin's own qualifiers, most to least preferred, then the host's (`hostFacets`). */
export type QualifyItem = {
  readonly id: TabId;
  readonly icon: string;
  readonly title: string;
  readonly facets: readonly string[];
  readonly singleton?: boolean | undefined;
};

const SEPARATOR = '\u0000';

/** Tabs that read alike are the ones with the same icon and the same title, in any case and spacing. */
const groupOf = (icon: string, title: string): string => `${icon}${SEPARATOR}${title.trim().toLowerCase()}`;

/** Tells the tabs of one group apart: for each tab that needs a qualifier, its parts go into `out`. Twins, identical in every facet, need none unless a third tab differs. */
function qualifyGroup(group: ReadonlyArray<Pick<QualifyItem, 'id' | 'facets'>>, out: Map<TabId, readonly string[]>): void {
  const width = Math.max(...group.map((item) => item.facets.length));
  const padded = group.map((item) => Array.from({ length: width }, (_, k) => item.facets[k] ?? ''));
  const kinds = [...new Map(padded.map((facets) => [facets.join(SEPARATOR), facets])).values()];
  if (kinds.length < 2) {
    return;
  }

  const pick = chooser(kinds, width);
  if (pick) {
    group.forEach((item, i) => {
      const parts = pick(padded[i] ?? []).filter((part) => part !== '');
      if (parts.length > 0) {
        out.set(item.id, parts);
      }
    });
  }
}

/**
 * The qualifier of each tab that needs one: a map from id to the parts of its qualifier (a tab that needs none has no entry). A singleton page is unique by construction and never
 * gets one. Twins, identical in every facet, count once, so a third tab elsewhere still tells itself apart and the twins share the text.
 */
export function qualify(items: readonly QualifyItem[]): Map<TabId, readonly string[]> {
  const out = new Map<TabId, readonly string[]>();
  const groups = new Map<string, QualifyItem[]>();
  for (const item of items) {
    if (item.singleton === true) {
      continue;
    }

    const key = groupOf(item.icon, item.title);
    const group = groups.get(key);
    if (group) {
      group.push(item);
    } else {
      groups.set(key, [item]);
    }
  }

  for (const group of groups.values()) {
    if (group.length > 1) {
      qualifyGroup(group, out);
    }
  }

  return out;
}

const unique = (values: readonly string[]): boolean => new Set(values).size === values.length;

/** The first facet that is different in every kind, else the first facets, as few as tell them all apart. */
function chooser(kinds: ReadonlyArray<readonly string[]>, width: number): ((facets: readonly string[]) => readonly string[]) | undefined {
  for (let k = 0; k < width; k += 1) {
    if (unique(kinds.map((facets) => facets[k] ?? ''))) {
      return (facets) => [facets[k] ?? ''];
    }
  }

  for (let k = 1; k < width; k += 1) {
    if (unique(kinds.map((facets) => facets.slice(0, k + 1).join(SEPARATOR)))) {
      return (facets) => facets.slice(0, k + 1);
    }
  }

  return undefined;
}

/**
 * The three facets the host adds after a plugin's own (ch16 T1): the scope, the crumb above the page's own (the plugin's name left out of the path), and the plugin's name.
 * Blank for a tab that has none: a host page says no scope, no path and no plugin name.
 */
export function hostFacets(face: Face): readonly [string, string, string] {
  const labels = face.path.map((crumb) => crumb.label);
  const crumbs = labels[0] === face.pluginName ? labels.slice(1) : labels;
  return [face.scope?.label ?? '', crumbs.length >= 2 ? (crumbs[crumbs.length - 2] ?? '') : '', face.pluginName];
}

/** What telling tabs apart reads of a face, worked out once per face object: a face is frozen, so the answer cannot go stale. `group` is absent for a singleton page. */
type FaceInfo = { readonly group: string | undefined; readonly facets: readonly string[] };

const faceInfos = new WeakMap<Face, FaceInfo>();

function infoOf(face: Face): FaceInfo {
  let info = faceInfos.get(face);
  if (info === undefined) {
    info = { group: face.singleton ? undefined : groupOf(face.icon, face.title), facets: [...face.facets, ...hostFacets(face)] };
    faceInfos.set(face, info);
  }

  return info;
}

/** Where a tab sits, for its tooltip: the plugin's path, with the scope's label in the place of the crumb it begins with, so a path that names its scope is not told twice. */
function whereOf(face: Face): string[] {
  const labels = face.path.map((crumb) => crumb.label);
  const rest = labels[0] === face.pluginName ? labels.slice(1) : labels;
  const scope = face.scope?.label ?? '';
  const at = scope === '' ? -1 : rest.findIndex((crumb) => scope === crumb || scope.startsWith(`${crumb} ·`));
  return at >= 0 ? rest.map((crumb, i) => (i === at ? scope : crumb)) : [scope, ...rest];
}

function identityOf(id: TabId, face: Face, parts: readonly string[]): Identity {
  const qualifier = parts.join(' · ');
  const scope = face.scope?.label ?? '';
  const says = (text: string) => parts.every((part) => text.includes(part));
  const where = scope !== '' && parts.some((part) => part.includes(scope)) ? parts : [scope, ...parts];
  const tip = [face.pluginName, ...whereOf(face)].filter((part) => part !== '').join(' › ');
  const labels = face.path.map((crumb) => crumb.label).join(' › ');
  const path: Crumb[] = face.path.slice();
  const leaf = path.at(-1);
  if (qualifier !== '' && leaf && !says(labels)) {
    path[path.length - 1] = Object.freeze({ ...leaf, label: `${leaf.label} · ${qualifier}` });
  }

  return Object.freeze({
    id,
    title: face.title,
    qualifier,
    parts: Object.freeze(parts.slice()),
    label: qualifier === '' ? face.title : `${face.title} · ${qualifier}`,
    name: [face.title, ...new Set(where)].filter((part) => part !== '').join(', '),
    tip: qualifier !== '' && !says(tip) ? `${tip} · ${qualifier}` : tip,
    path: Object.freeze(path),
  });
}

const sameIdentity = (a: Identity, b: Identity): boolean =>
  a.title === b.title && a.qualifier === b.qualifier && a.label === b.label && a.name === b.name && a.tip === b.tip && a.path.length === b.path.length
  && a.path.every((crumb, i) => crumb.label === b.path[i]?.label && crumb.route === b.path[i]?.route);

const NO_PARTS: readonly string[] = Object.freeze([]);

const sameParts = (a: readonly string[], b: readonly string[]): boolean => a === b || (a.length === b.length && a.every((part, i) => part === b[i]));

/** What the strip keeps of a tab's identity between two passes: the inputs it was made from, so that the next pass can see at a glance that it need not be made again. */
export type IdentityEntry = {
  readonly face: Face;
  readonly parts: readonly string[];
  readonly identity: Identity;
};

/**
 * The identity of every tab in the strip. Where a tab's face and qualifier are the ones `previous` made its identity from, the same entry comes back untouched; where they
 * changed but the identity reads the same, the same identity object does. So what reads one tab's identity does not see another tab's change.
 */
export function identities(state: TabsState, previous: ReadonlyMap<TabId, IdentityEntry> | undefined): Map<TabId, IdentityEntry> {
  const { order, tabs } = state;
  const faces: Array<Face | undefined> = [];
  const first = new Map<string, number>();
  let crowds: Map<string, number[]> | undefined;
  for (let i = 0; i < order.length; i += 1) {
    const face = tabs[order[i] ?? '']?.face;
    faces.push(face);
    const group = face === undefined ? undefined : infoOf(face).group;
    if (group === undefined) {
      continue;
    }

    const at = first.get(group);
    if (at === undefined) {
      first.set(group, i);
    } else {
      crowds ??= new Map();
      const members = crowds.get(group);
      if (members) {
        members.push(i);
      } else {
        crowds.set(group, [at, i]);
      }
    }
  }

  // Only a group of two or more tabs needs telling apart, and most strips have none.
  let qualifiers: Map<TabId, readonly string[]> | undefined;
  if (crowds) {
    qualifiers = new Map();
    for (const members of crowds.values()) {
      qualifyGroup(members.flatMap((i) => {
        const face = faces[i];
        return face === undefined ? [] : [{ id: order[i] ?? '', facets: infoOf(face).facets }];
      }), qualifiers);
    }
  }

  const out = new Map<TabId, IdentityEntry>();
  for (let i = 0; i < order.length; i += 1) {
    const face = faces[i];
    const id = order[i] ?? '';
    if (face === undefined) {
      continue;
    }

    const parts = qualifiers?.get(id) ?? NO_PARTS;
    const before = previous?.get(id);
    if (before?.face === face && sameParts(before.parts, parts)) {
      out.set(id, before);
      continue;
    }

    const made = identityOf(id, face, parts);
    out.set(id, { face, parts, identity: before !== undefined && sameIdentity(before.identity, made) ? before.identity : made });
  }

  return out;
}
