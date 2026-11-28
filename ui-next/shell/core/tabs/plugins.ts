import { isObject } from './json';
import { faceOf, keyOf } from './face';
import { normaliseRoute } from './route';
import type { Availability, Contributions, Description, Face, Route, TabRoute } from './types';

// The model's side of the seam: every call into `Contributions` goes through here. A plugin's code can throw or answer nonsense, and a model that
// shares a strip with other plugins' tabs must not follow it (ch16 S89): each failure is caught, reported once to `onError`, and answered with the
// value that costs the user least. The members are described where they are used.

export type ErrorHook = (error: unknown, where: string) => void;

/** What the model does with a failure when it was not given a hook: say so on the console, once per call. */
export const logError: ErrorHook = (error, where) => {
  console.error(`[tabs] ${where}`, error);
};

export type Plugins = {
  /** The plugin's description, or `undefined` when it says nothing (or failed to). */
  readonly describe: (route: TabRoute) => Description | undefined;
  /** A plugin that cannot say is taken to be available: the model does not lock a user out of a page because a check failed. */
  readonly availability: (route: TabRoute) => Availability;
  /** The route to open, or `undefined` to refuse it. A plugin whose `complete` fails refuses (it never falls through to a route the plugin did not choose). */
  readonly complete: (route: TabRoute, from: TabRoute | undefined, source: string) => TabRoute | undefined;
  /** The route a saved tab comes back as: `false` drops it. A plugin whose `restore` fails leaves the tab as it was saved; one that answers nonsense drops it. */
  readonly restore: (route: TabRoute) => TabRoute | false;
  /** The face a saved tab comes back with: what the host lets stand of it. A host that has nothing to take out, and one whose `restoreFace` fails or answers nonsense, leaves the face as it was saved. */
  readonly restoreFace: (face: Face, route: Route) => Face;
  /** The route a window opens with, or the plugin's own first page. */
  readonly home: (plugin?: string) => Route | undefined;
  /** The face and key of a route, as the plugin describes it now. `described` is false when the plugin said nothing, or only a stand-in (`Description.provisional`): a tab that has a face keeps it then. */
  readonly look: (route: TabRoute) => { readonly face: Face; readonly key: string; readonly described: boolean };
};

const UNAVAILABLE = 'unavailable';

function availabilityOf(value: unknown): Availability {
  if (isObject(value) && value.state === UNAVAILABLE) {
    return { state: UNAVAILABLE, reason: typeof value.reason === 'string' ? value.reason : '' };
  }

  if (isObject(value) && value.state === 'degraded') {
    return { state: 'degraded', ...(typeof value.reason === 'string' ? { reason: value.reason } : {}) };
  }

  return { state: 'available' };
}

export function guardContributions(contributions: Contributions, onError: ErrorHook): Plugins {
  const guarded = <T>(run: () => T, fallback: T, where: string): T => {
    try {
      return run();
    } catch (error) {
      onError(error, where);
      return fallback;
    }
  };

  const describe = (route: TabRoute) => {
    const answer = route.kind === 'extension-view'
      ? guarded<unknown>(() => contributions.describeView?.(route), undefined, `describeView() of ${route.plugin}`)
      : guarded<unknown>(() => contributions.describe(route), undefined, `describe() of ${route.plugin}`);
    return isObject(answer) ? (answer as Description) : undefined;
  };

  return {
    describe,
    availability: (route) => {
      // A saved place stays addressable when its binding is gone. Admission to draw it belongs to the foreground host.
      if (route.kind === 'extension-view') {
        return { state: 'available' };
      }

      const { availability } = contributions;
      return availability ? availabilityOf(guarded<unknown>(() => availability(route), undefined, `availability() of ${route.plugin}`)) : { state: 'available' };
    },
    complete: (route, from, source) => {
      if (route.kind === 'extension-view') {
        return route;
      }

      const { complete } = contributions;
      if (!complete) {
        return route;
      }

      const answer = guarded<unknown>(() => complete(route, { from, source }), undefined, `complete() of ${route.plugin}`);
      return answer === route ? route : normaliseRoute(answer);
    },
    restore: (route) => {
      if (route.kind === 'extension-view') {
        return route;
      }

      const { restore } = contributions;
      if (!restore) {
        return route;
      }

      const answer = guarded<unknown>(() => restore(route), route, `restore() of ${route.plugin}`);
      return answer === false ? false : (answer === route ? route : normaliseRoute(answer) ?? false);
    },
    restoreFace: (face, route) => {
      const { restoreFace } = contributions;
      if (!restoreFace) {
        return face;
      }

      const answer = guarded<unknown>(() => restoreFace(face, route), face, `restoreFace() of ${route.plugin}`);
      return isObject(answer) ? (answer as Face) : face;
    },
    home: (plugin) => {
      const { home } = contributions;
      return home ? normaliseRoute(guarded<unknown>(() => home(plugin), undefined, `home() of ${plugin ?? 'the window'}`)) : undefined;
    },
    look: (route) => {
      const description = describe(route);
      const face = faceOf(route, description);
      return { face, key: keyOf(route, description, face), described: route.kind === 'extension-view' || (description !== undefined && description.provisional !== true) };
    },
  };
}
