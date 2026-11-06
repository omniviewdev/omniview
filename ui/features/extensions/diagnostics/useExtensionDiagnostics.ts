import { useContext, useMemo, useSyncExternalStore } from 'react';
import { PluginServiceContext } from '@/features/plugins/react/context';
import { EXTENSION_REGISTRY } from '../store';
import { assertDiagnosticSnapshotCurrent, captureExtensionSnapshot, lookupExtensionContext, recoverExtensionContribution } from './model';
import type { DiagnosticLookupRequest, ExtensionDiagnosticSnapshot } from './types';
import type { DiagnosticService } from './model';
import { diagnosticRuntimeIdentity } from './runtimeIdentity';

function createDiagnosticStore(service: DiagnosticService, windowName: string | null) {
  let cached: ExtensionDiagnosticSnapshot | undefined;
  const listeners = new Set<() => void>();
  let scheduled = false;
  let generation = 0;
  let cleanups: Array<() => void> = [];
  const invalidate = () => {
    // Service updates can synchronously follow registry mutations. Publish after both settle.
    cached = undefined;
    if (scheduled) {
      return;
    }

    scheduled = true;
    const token = generation;
    queueMicrotask(() => {
      if (token !== generation) {
        return;
      }

      scheduled = false;
      for (const listener of listeners) {
        listener();
      }
    });
  };

  return {
    subscribe(listener: () => void) {
      if (!listeners.size) {
        cached = undefined;
        cleanups = [EXTENSION_REGISTRY.subscribe(invalidate), service.subscribe(invalidate), service.onQuarantineActivated(invalidate)];
      }

      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (!listeners.size) {
          cleanups.forEach(cleanup => {
            cleanup(); 
          });
          cleanups = [];
          generation++;
          scheduled = false;
          cached = undefined;
        }
      };
    },
    getSnapshot() {
      cached ??= captureExtensionSnapshot(EXTENSION_REGISTRY, service, { windowName: windowName ?? '' });
      return cached;
    },
    capture(includeSensitive = false) {
      if (!windowName) {
        throw new Error('Extension diagnostics runtime identity is unavailable.');
      }

      return captureExtensionSnapshot(EXTENSION_REGISTRY, service, { windowName, includeSensitive });
    },
    lookup(request: DiagnosticLookupRequest, expectedSnapshot?: ExtensionDiagnosticSnapshot) {
      if (!windowName) {
        throw new Error('Extension diagnostics runtime identity is unavailable.');
      }

      if (expectedSnapshot) {
        assertDiagnosticSnapshotCurrent(expectedSnapshot);
      }

      return lookupExtensionContext(EXTENSION_REGISTRY, service, request, windowName);
    },
    unquarantine(contributionId: string, expectedSnapshot?: ExtensionDiagnosticSnapshot) {
      if (!windowName) {
        throw new Error('Extension diagnostics runtime identity is unavailable.');
      }

      recoverExtensionContribution(EXTENSION_REGISTRY, service, contributionId, expectedSnapshot, windowName);
    },
  };
}


export function useExtensionDiagnostics() {
  const service = useContext(PluginServiceContext);
  if (!service) {
    throw new Error('useExtensionDiagnostics must be used within PluginServiceProvider');
  }

  const { windowName, identityError } = useSyncExternalStore(diagnosticRuntimeIdentity.subscribe, diagnosticRuntimeIdentity.getSnapshot, diagnosticRuntimeIdentity.getSnapshot);
  const store = useMemo(() => createDiagnosticStore(service, windowName), [service, windowName]);
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  return { snapshot, capture: store.capture, lookup: store.lookup, unquarantine: store.unquarantine, windowName, identityError };
}
