import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { GetInstanceInfo } from '@omniviewdev/runtime/api';
import { getBootIdentity, type BootIdentity } from './boot';

// Safe UI projection of the host descriptor; intentionally excludes discovery
// credentials, token-file references, process internals, and arbitrary errors.
export type InstanceInfo = {
  schemaVersion: number;
  instanceID: string;
  workspaceID: string;
  displayName: string;
  kind: string;
  channel: string;
  stateRoot: string;
  generation: string;
  version: string;
  commit: string;
  readiness: string;
  repositories: Array<{ id: string; path: string; ref: string; commit: string }> | null;
  endpoints: {
    browser: string | null;
    vite: string | null;
    hmr: string | null;
    mcp: string | null;
    control: string | null;
    health: string | null;
  };
};
type InstanceState = {
  identity: BootIdentity | null;
  info: InstanceInfo | null;
  status: 'unavailable' | 'boot' | 'refreshing' | 'confirmed' | 'error' | 'mismatch';
};
export type InstanceContextValue = InstanceState & {
  refreshInfo: () => Promise<void>;
};

const initialIdentity = getBootIdentity();
const initialValue: InstanceState = {
  identity: initialIdentity,
  info: null,
  status: initialIdentity === null ? 'unavailable' : 'boot',
};
const InstanceContext = createContext<InstanceContextValue | null>(null);

export function InstanceProvider({ children }: { children: ReactNode }) {
  const [value, setValue] = useState<InstanceState>(() => (
    initialIdentity === null ? initialValue : { ...initialValue, status: 'refreshing' }
  ));
  const requestSequence = useRef(0);

  const requestInfo = useCallback(async () => {
    // Plain browser previews have no host or binding endpoint; never invent one.
    if (initialIdentity === null) {
      return;
    }

    const request = ++requestSequence.current;
    await GetInstanceInfo().then(info => {
      if (request !== requestSequence.current) {
        return;
      }

      if (info.schemaVersion !== 1 || info.instanceID !== initialIdentity.instanceID
        || info.kind !== initialIdentity.kind || info.generation !== initialIdentity.generation
        || !info.displayName?.trim()) {
        // Changing namespaces after first paint could read another profile's data.
        setValue({ identity: initialIdentity, info: null, status: 'mismatch' });
        return;
      }

      setValue({
        identity: { ...initialIdentity, displayName: info.displayName },
        info,
        status: 'confirmed',
      });
    }, () => {
      if (request === requestSequence.current) {
        setValue({ identity: initialIdentity, info: null, status: 'error' });
      }
    });
  }, []);

  const refreshInfo = useCallback(async () => {
    if (initialIdentity === null) {
      return;
    }

    // Hide stale host data while an explicit refresh is pending.
    setValue(current => ({ ...current, info: null, status: 'refreshing' }));
    await requestInfo();
  }, [requestInfo]);

  useEffect(() => {
    void requestInfo();
    return () => {
      ++requestSequence.current; 
    };
  }, [requestInfo]);

  useEffect(() => {
    document.title = value.identity === null
      ? 'Omniview — Instance unavailable'
      : value.identity.kind === 'development'
        ? `Omniview — DEV · ${value.identity.displayName}`
        : 'Omniview';
  }, [value.identity]);

  return <InstanceContext.Provider value={{ ...value, refreshInfo }}>{children}</InstanceContext.Provider>;
}

export function useInstance(): InstanceContextValue {
  const instance = useContext(InstanceContext);
  if (instance === null) {
    throw new Error('useInstance must be used within InstanceProvider');
  }

  return instance;
}
