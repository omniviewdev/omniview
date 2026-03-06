import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

import { useWatchState } from '@omniviewdev/runtime';
import { ResourceClient } from '@omniviewdev/runtime/api';

import ConnectionStateDialog from './ConnectionStateDialog';
import type { ConnectionStateTarget } from './types';

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

interface ConnectionStateContextValue {
  show: (target: ConnectionStateTarget) => void;
}

const ConnectionStateContext = createContext<ConnectionStateContextValue | undefined>(undefined);

export const useConnectionStateDialog = (): ConnectionStateContextValue => {
  const ctx = useContext(ConnectionStateContext);
  if (!ctx) throw new Error('useConnectionStateDialog must be used within a ConnectionStateProvider');
  return ctx;
};

// ---------------------------------------------------------------------------
// Inner dialog — only mounts when we have a valid target, so useWatchState
// is never called with empty pluginID (which would throw from
// useResolvedPluginId at the app level where there's no PluginContext).
// ---------------------------------------------------------------------------

function ActiveConnectionStateDialog({
  target,
  open,
  onClose,
  manualOpenRef,
}: {
  target: ConnectionStateTarget;
  open: boolean;
  onClose: () => void;
  manualOpenRef: React.RefObject<boolean>;
}) {
  const { summary, isFullySynced } = useWatchState({
    pluginID: target.pluginID,
    connectionID: target.connectionID,
  });

  const resources = summary.data?.resources ?? {};
  const resourceCounts = summary.data?.resourceCounts ?? {};

  const handleRetryResource = useCallback(async (resourceKey: string) => {
    try {
      await ResourceClient.EnsureResourceWatch(target.pluginID, target.connectionID, resourceKey);
    } catch (err) {
      console.error('Failed to retry watch:', err);
    }
  }, [target.pluginID, target.connectionID]);

  // Auto-close after sync completes (only for auto-opened dialogs)
  useEffect(() => {
    if (isFullySynced && open && !manualOpenRef.current) {
      const timer = setTimeout(onClose, 1500);
      return () => clearTimeout(timer);
    }
  }, [isFullySynced, open, onClose, manualOpenRef]);

  return (
    <ConnectionStateDialog
      open={open}
      onClose={onClose}
      connectionName={target.connectionName}
      resources={resources}
      resourceCounts={resourceCounts}
      onRetryResource={handleRetryResource}
    />
  );
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export const ConnectionStateProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<ConnectionStateTarget | null>(null);

  // Track whether the dialog was opened manually (footer Details click or
  // programmatic show()) vs auto-opened. Auto-opened dialogs auto-close
  // after sync completes; manual ones stay open until dismissed.
  const manualOpenRef = useRef(false);

  // ---- Public API ----
  const show = useCallback((t: ConnectionStateTarget) => {
    manualOpenRef.current = true;
    setTarget(t);
    setOpen(true);
  }, []);

  const handleClose = useCallback(() => {
    manualOpenRef.current = false;
    setOpen(false);
  }, []);

  // ---- DOM event listener for ov:show-connection-state ----
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<ConnectionStateTarget>).detail;
      if (detail?.pluginID && detail?.connectionID) {
        manualOpenRef.current = true;
        setTarget(detail);
        setOpen(true);
      }
    };
    window.addEventListener('ov:show-connection-state', handler);
    return () => window.removeEventListener('ov:show-connection-state', handler);
  }, []);

  return (
    <ConnectionStateContext.Provider value={{ show }}>
      {children}
      {target && (
        <ActiveConnectionStateDialog
          target={target}
          open={open}
          onClose={handleClose}
          manualOpenRef={manualOpenRef}
        />
      )}
    </ConnectionStateContext.Provider>
  );
};
