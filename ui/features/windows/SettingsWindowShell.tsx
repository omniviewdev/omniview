import { useCallback, useEffect, useRef, useState } from 'react';
import { HashRouter } from 'react-router';
import { focusManager, useQueryClient } from '@tanstack/react-query';
import { WindowClient } from '@omniviewdev/runtime/api';
import { Events } from '@omniviewdev/runtime/runtime';
import SettingsPage from '@/pages/settings';
import styles from './SettingsWindowShell.module.css';

type SettingsState = { requestId: number; target: string; visible: boolean };

/** Retained for the lifetime of the dedicated native Settings window. */
export function SettingsWindowShell() {
  const [state, setState] = useState<SettingsState | null>(null);
  const [error, setError] = useState(false);
  const queryClient = useQueryClient();
  const locationWrites = useRef<Promise<void> | null>(null);
  const visible = state?.visible;

  useEffect(() => {
    let disposed = false;
    let receivedEvent = false;
    // Subscribe before reading: a request during startup must not be lost or
    // overwritten by a slower initial binding response.
    const off = Events.On('settings/state', (event) => {
      receivedEvent = true;
      if (!disposed) {
        setError(false);
        setState(event.data);
      }
    });
    void WindowClient.GetSettingsState().then((initial) => {
      if (!disposed && !receivedEvent) {
        setState(initial);
      }
    }).catch((cause: unknown) => {
      console.error('[settings] could not load window state', cause);
      if (!disposed && !receivedEvent) {
        setError(true);
      }
    });
    return () => {
      disposed = true; off(); 
    };
  }, []);

  useEffect(() => {
    if (visible === undefined) {
      return;
    }

    focusManager.setFocused(visible ? undefined : false);
    if (visible) {
      void queryClient.refetchQueries({ type: 'active', stale: true });
    }

    return () => {
      focusManager.setFocused(undefined); 
    };
  }, [visible, queryClient]);

  const close = useCallback(() => {
    void WindowClient.HideSettings().catch((cause: unknown) => {
      console.error('[settings] could not hide window', cause);
    });
  }, []);
  const locationChanged = useCallback((target: string, requestId: number) => {
    locationWrites.current = (locationWrites.current ?? Promise.resolve()).then(async () =>
      WindowClient.SetSettingsLocation(target, requestId),
    ).catch((cause: unknown) => {
      console.error('[settings] could not retain location', cause);
    });
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const modifier = /mac/i.test(navigator.userAgent) ? event.metaKey : event.ctrlKey;
      if (!event.defaultPrevented && !event.isComposing && modifier && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'w') {
        event.preventDefault();
        close();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown); 
    };
  }, [close]);

  return (
    <div className={styles.Root} data-visible={state?.visible !== false}>
      {error ? <p role='alert'>Could not load Settings. Reopen the window to try again.</p> : state ? (
        <HashRouter>
          <SettingsPage request={state} onLocationChange={locationChanged} onClose={close} />
        </HashRouter>
      ) : <p role='status'>Loading Settings…</p>}
    </div>
  );
}
