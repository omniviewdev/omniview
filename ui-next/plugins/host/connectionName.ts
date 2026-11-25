import { clip, LIMITS, type Face, type Route, type ShellLaneFace, type ShellScopeFace, type ShellScopePicker } from '../../shell';

// The ONE place a route's connection KEY becomes something a person reads (C1g). A route carries a connection by a key: the plugin's own id for it (`kind-kind-57a082bd74`), which the tab model compares and a plugin's
// calls use and which nobody is meant to read. The NAME a person knows the connection by is what the plugin's page says in its scope lane (`FrameV1.scope`). The shell says the name, and where no name is known it says
// nothing about the connection: the key is never drawn, in a tab's label, its accessible name, its tooltip, the status bar's path, a page's header or a palette's row.
//
// It is one place so that no surface can read the key by accident: the host makes the FACE of every tab from a route (`contributions.describe`), with the name where it has one, and every surface of the shell reads the
// face. `connectionName.test.ts` holds the list of the files that read a route's connection parameter at all.

/** The label a plugin written before the marker gives the lane's face that says the connection (the design lab's lane does too). */
const FACE_LABEL = 'connection';

/**
 * The longest NAME of a connection the host holds, in characters (N2 of the review of HM3b). A name is a word a person or a tool gave a connection, a few dozen characters at most, and the page's heading draws it whole; one of a million characters is a broken or a hostile
 * plugin's, and WebKit, the native app's engine, stalled for longer than 45 s laying one out in the heading (a name of 200,000 was fine, one of 400,000 was not). So a name is clipped once, where it comes in (`nameText`), and no surface can draw an unclipped one. 200 is the line the
 * host already allows a connection's secondary text (`DETAIL_MAX`), far above any name a person gives a connection (Home draws one of 110 characters whole) and far below what stalls; the tab's own limit for a scope label, `LIMITS.scopeLabel`, is a label's, and 24 would
 * cut a name a person chose.
 */
export const NAME_MAX = 200;

/**
 * The name a text says: trimmed, and clipped to `NAME_MAX` with the shell's own `clip` (the one every label of a tab's face is clipped with), or `undefined` when it is not text or says nothing. A name comes in here, from a page's lane, from what a window has learned and from
 * the host's own list of connections (`connections/words.ts`), so nothing that is made from a name is longer than `NAME_MAX`: the heading, the path, the tab, Home's rows, the picker's options.
 */
export function nameText(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const text = value.trim();
  return text === '' ? undefined : clip(text, NAME_MAX);
}

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
    return nameText(marked.text) ?? null;
  }

  for (const face of faces) {
    if (face.label.trim().toLowerCase() === FACE_LABEL) {
      const text = nameText(face.text);
      if (text !== undefined) {
        return text;
      }
    }
  }

  return undefined;
}

/**
 * The lane a page published, as the shell draws it (HM1): each face the contract has, copied member by member (a plugin's own object is never handed on, so a plugin cannot give a face a picker or any other member the shell reads), and the one
 * face that says the connection (the one `laneNameOf` reads: the marked face, else a face labelled Connection) made a control by the picker `pick` makes of it, from the glyph and the text the face says (`undefined`: no picker, the face stays text).
 * A face that is not valid is left out, as `laneNameOf` leaves it out. Every face's text is clipped to `NAME_MAX` (N2), so the lane draws no longer a name than the heading does, and the picker is made from the text the lane says. `undefined` when the page published no lane.
 */
export function laneFor(lane: readonly ShellScopeFace[] | undefined, pick: ((face: Pick<ShellScopeFace, 'icon' | 'text'>) => ShellScopePicker | undefined) | undefined): readonly ShellLaneFace[] | undefined {
  if (!Array.isArray(lane)) {
    return undefined;
  }

  const faces = (lane as readonly unknown[]).filter(isFace);
  const marked = faces.find((face) => face.role === 'connection');
  const legacy = marked ?? faces.find((face) => face.label.trim().toLowerCase() === FACE_LABEL && nameText(face.text) !== undefined);
  return faces.map((face): ShellLaneFace => {
    const copy: ShellScopeFace = { label: face.label, icon: face.icon as ShellScopeFace['icon'], text: clip(face.text, NAME_MAX), ...(face.role === 'connection' ? { role: 'connection' as const } : {}) };
    const picker = face === legacy ? pick?.(copy) : undefined;
    return picker === undefined ? copy : { ...copy, picker };
  });
}

/**
 * The names this window has learned for the connections of its plugins, by plugin and key: from the lane a page published, and from the face a tab was saved with. A tab whose page was never drawn in this window
 * (a restored one, one opened in the background) is told the name of its connection from here, so it does not read as a tab of no connection. Nothing is saved: a window learns them again as its pages are drawn.
 */
export class ConnectionNames {
  private readonly names = new Map<string, string>();
  private readonly listeners = new Set<() => void>();

  /** The name learned for the connection `key` of `plugin`. `undefined`: none. */
  get(plugin: string, key: string): string | undefined {
    return this.names.get(JSON.stringify([plugin, key]));
  }

  /**
   * Remembers `name` for the connection `key` of `plugin`: the latest is the one. An empty name is none, and a name is held as `nameText` says it (clipped to `NAME_MAX`) BEFORE it is compared, stored and told. Those who `subscribe` are told when what is remembered
   * changed, and not when a name is learned again as it is: a name that is learned again, however long it came, is the same name once it is clipped.
   */
  learn(plugin: string, key: string, name: string): void {
    const text = nameText(name);
    const id = JSON.stringify([plugin, key]);
    if (text === undefined || this.names.get(id) === text) {
      return;
    }

    this.names.set(id, text);
    for (const listener of [...this.listeners]) {
      if (this.listeners.has(listener)) {
        listener();
      }
    }
  }

  /**
   * Tells `listener` when a learned name changed: a connection that was not named, or a name that was another. It is told as the name is learned, with the name there to be read, and its work is its own to defer. Each call is a subscription of
   * its own, whatever function it is given. Answers the function that takes it off.
   */
  subscribe(listener: () => void): () => void {
    const subscription = (): void => {
      listener();
    };

    this.listeners.add(subscription);
    return () => {
      this.listeners.delete(subscription);
    };
  }
}

/**
 * The NAME a page says its connection by, for its header and its path: the one its own lane says (`laneNameOf`), else the one this window has learned for the connection its route names (`ConnectionNames`), else none. A lane that says it has no name
 * (`null`) leaves the page with none, and a name learned before is not put in its place. `undefined`: no name is known, and the page says no connection. The detail page and the overview page both read it this way, so there is one rule for it.
 */
export function connectionNameOf(lane: unknown, names: ConnectionNames, plugin: string, connection: string | undefined): string | undefined {
  const said = laneNameOf(lane);
  return said === null ? undefined : (said ?? (connection === undefined ? undefined : names.get(plugin, connection)));
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
