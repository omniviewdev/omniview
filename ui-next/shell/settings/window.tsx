import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { createPageMemory } from './host';
import type { SettingsSession } from './model/session';
import { pageOfTarget } from './model/target';
import type { SettingsClient, SettingsRequest, SettingsWindowClient } from './model/types';
import { createSession, runtimeWindowClient } from './runtime';
import { WindowSurface } from './view/WindowSurface';

// Settings as the content of its own window: the lazy chunk the entry loads when the window it is in is of kind `settings` (`WindowKindScreen`). The window is the host's, recycled for the life of the app: opened and hidden, never
// destroyed, so this component, its session and the page it is on are kept while it is hidden and nothing in it runs (no timer, no poll). The host's requests reach it as `settings/state` events: a new `requestId` names a page, a change
// of `visible` is a show or a hide.

export type SettingsWindowProps = {
  /** The host's settings service. Absent: the runtime's. */
  readonly client?: SettingsClient | undefined;
  /** The host's window service. Absent: the runtime's. */
  readonly windows?: SettingsWindowClient | undefined;
};

/** The session of the window's life: made when the window mounts and disposed when it goes (a development double mount makes and disposes one in between), and told to what draws it by a store. */
function createLifetime(client: SettingsClient | undefined) {
  let session: SettingsSession | undefined;
  const listeners = new Set<() => void>();
  return {
    get: () => session,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    start: () => {
      const made = createSession(client);
      session = made;
      for (const listener of [...listeners]) {
        listener();
      }

      return () => {
        made.dispose();
        if (session === made) {
          session = undefined;
        }
      };
    },
  };
}

export default function SettingsWindow({ client, windows }: SettingsWindowProps) {
  const [lifetime] = useState(() => createLifetime(client));
  useEffect(() => lifetime.start(), [lifetime]);
  const session = useSyncExternalStore(lifetime.subscribe, lifetime.get);
  const [page] = useState(createPageMemory);
  const [source] = useState(() => windows ?? runtimeWindowClient());
  const [request, setRequest] = useState(0);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    let disposed = false;
    let seen: number | undefined;
    let shown: boolean | undefined;
    let received = false;
    const apply = (state: SettingsRequest): void => {
      if (disposed) {
        return;
      }

      if (state.requestId !== seen) {
        seen = state.requestId;
        const named = pageOfTarget(state.target);
        if (named !== undefined) {
          page.set(named);
          setRequest((count) => count + 1);
        }
      }

      if (state.visible && shown === false) {
        // Shown again: what the host holds now, because the page was not looking while it was hidden.
        session?.refresh();
      }

      shown = state.visible;
      setVisible(state.visible);
    };

    // Subscribe before reading, as the original did: a request that arrives while the first answer is on its way is not lost to the slower answer.
    const off = source.onState((state) => {
      received = true;
      apply(state);
    });
    source.state().then(
      (initial) => {
        if (!received) {
          apply(initial);
        }
      },
      (error: unknown) => {
        console.error('[settings] could not read the window state', error);
      },
    );
    return () => {
      disposed = true;
      off();
    };
  }, [page, session, source]);

  const close = useCallback(() => {
    source.hide().catch((error: unknown) => {
      console.error('[settings] could not hide the window', error);
    });
  }, [source]);

  return session === undefined ? null : <WindowSurface session={session} page={page} onClose={close} request={request} visible={visible} />;
}
