import { clip, LIMITS, type Face, type Route } from '../../shell';

// The ONE place a route's connection KEY becomes something a person reads (C1g). A route carries a connection by a key: the plugin's own id for it (`kind-kind-57a082bd74`), which the tab model compares and a plugin's
// calls use and which nobody is meant to read. The NAME a person knows the connection by is what the plugin's page says in its scope lane (`FrameV1.scope`). The shell says the name, and where no name is known it says
// nothing about the connection: the key is never drawn, in a tab's label, its accessible name, its tooltip, the status bar's path, a page's header or a palette's row.
//
// It is one place so that no surface can read the key by accident: the host makes the FACE of every tab from a route (`contributions.describe`), with the name where it has one, and every surface of the shell reads the
// face. `connectionName.test.ts` holds the list of the files that read a route's connection parameter at all.

/** The label a plugin written before the marker gives the lane's face that says the connection (the design lab's lane does too). */
const FACE_LABEL = 'connection';

const textOf = (value: unknown): string | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }

  const text = value.trim();
  return text === '' ? undefined : text;
};

/** A face of a lane as the contract has it (`ShellScopeFace`): a label, a glyph and a text, all text. A plugin's data is not trusted, and a face that is not valid is not the connection, marked or not. */
type LaneFace = Record<string, unknown> & { readonly label: string; readonly icon: string; readonly text: string };
const isFace = (face: unknown): face is LaneFace =>
  typeof face === 'object' && face !== null && 'label' in face && 'icon' in face && 'text' in face && typeof face.label === 'string' && typeof face.icon === 'string' && typeof face.text === 'string';

/**
 * The name of the connection a page is read in, from the scope lane it published. The face that says it is the one the plugin MARKED (`role: 'connection'`, whatever its label): the plugin saying which face it is, so its text
 * is the answer, even when it has none yet, and then the lane says there is NO name (`null`: the window does not fall back on a name it learned). A plugin written before the marker is read by the face's label, Connection.
 * The first valid face of its kind wins, and a lane that is not what the contract says names nothing. `undefined`: the lane says nothing of the connection, so another source may.
 */
export function laneNameOf(lane: unknown): string | null | undefined {
  if (!Array.isArray(lane)) {
    return undefined;
  }

  const faces = (lane as readonly unknown[]).filter(isFace);
  const marked = faces.find((face) => face.role === 'connection');
  if (marked !== undefined) {
    return textOf(marked.text) ?? null;
  }

  for (const face of faces) {
    if (face.label.trim().toLowerCase() === FACE_LABEL) {
      const text = textOf(face.text);
      if (text !== undefined) {
        return text;
      }
    }
  }

  return undefined;
}

/**
 * The names this window has learned for the connections of its plugins, by plugin and key: from the lane a page published, and from the face a tab was saved with. A tab whose page was never drawn in this window
 * (a restored one, one opened in the background) is told the name of its connection from here, so it does not read as a tab of no connection. Nothing is saved: a window learns them again as its pages are drawn.
 */
export class ConnectionNames {
  private readonly names = new Map<string, string>();

  /** The name learned for the connection `key` of `plugin`. `undefined`: none. */
  get(plugin: string, key: string): string | undefined {
    return this.names.get(JSON.stringify([plugin, key]));
  }

  /** Remembers `name` for the connection `key` of `plugin`: the latest is the one. An empty name is none. */
  learn(plugin: string, key: string, name: string): void {
    const text = textOf(name);
    if (text !== undefined) {
      this.names.set(JSON.stringify([plugin, key]), text);
    }
  }
}

/** Whether a scope's label is the key: the key itself, or the key clipped as the tab model clips every scope label (`LIMITS.scopeLabel`), which is how a saved face holds a long key. Nothing else is: a name may begin like a key. */
export const isScopeKey = (label: string, key: string): boolean => label === key || label === clip(key, LIMITS.scopeLabel);

/**
 * The qualifiers of a tab with the connection said by its name. The host puts the connection LAST among them (`describe`, `describeDetail`): when that one is the key it becomes the name, or is left out when none is
 * known. No other qualifier is read, because a resource may be called like the key. With no key, the labels as they are.
 */
export function said(labels: readonly string[], key: string | undefined, name: string | undefined): string[] {
  if (key === undefined || labels.at(-1) !== key) {
    return [...labels];
  }

  return [...labels.slice(0, -1), ...(name === undefined ? [] : [name])];
}

/**
 * The labels of a path with the connection said by its name. The host puts the connection right after the plugin (`describe`, `describeDetail`): the second crumb, when it is the key and is not the page itself, becomes the
 * name, or is left out when none is known. No other crumb is read, because a list or a page may be called like the key. With no key, the labels as they are.
 */
export function pathSaid(labels: readonly string[], key: string | undefined, name: string | undefined): string[] {
  if (key === undefined || labels.length < 3 || labels[1] !== key) {
    return [...labels];
  }

  return labels.flatMap((label, index) => (index !== 1 ? [label] : name === undefined ? [] : [name]));
}

/**
 * A face a saved tab comes back with, before the tab keeps it (the plugin has not loaded, so the tab is drawn as the user left it). A build before the names drew the key, and saved it in the face: the scope's label, the
 * crumb after the plugin's and the last qualifier. A tab drawn while its plugin loads must show none of it: the key is put out, or the name this window has learned put in its place. That build is told by the scope's label,
 * which is the key in its faces (`isScopeKey`: the key may be clipped to fit); a face of this build holds the name there, or nothing, and what it holds that is called like the key is a list's, a page's or a resource's and is
 * left as it is. A name a face holds is kept and learned, so the tab says it again once its plugin has loaded, though its page has not been drawn. The scope's id stays: it is how places are told apart, and it is never drawn.
 */
export function restoredFace(face: Face, route: Route, names: ConnectionNames): Face {
  const key = typeof route.params.connection === 'string' ? route.params.connection : undefined;
  const { scope } = face;
  if (key === undefined || scope === undefined) {
    return face;
  }

  if (!isScopeKey(scope.label, key)) {
    if (scope.label !== '') {
      names.learn(route.plugin, key, scope.label);
    }

    return face;
  }

  const name = names.get(route.plugin, key);
  const crumbs = face.path.length >= 3 && face.path[1]?.label === key ? face.path.flatMap((crumb, index) => (index !== 1 ? [crumb] : name === undefined ? [] : [Object.freeze({ ...crumb, label: name })])) : face.path;
  return Object.freeze({
    ...face,
    scope: Object.freeze({ id: scope.id, label: name ?? '' }),
    path: Object.freeze(crumbs),
    facets: Object.freeze(said(face.facets, key, name)),
  });
}
