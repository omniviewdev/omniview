import { useEffect } from 'react';
import { Events } from '@omniviewdev/runtime/runtime';
import { ExtensionDiagnosticsClient } from '@omniviewdev/runtime/api';
import { filterExtensionSnapshot } from './model';
import { useExtensionDiagnostics } from './useExtensionDiagnostics';
import type { DiagnosticFilter } from './types';
import { RESOURCE_SIDEBAR_EXTENSION_POINT_ID } from '../sidebar/extensionPoint';
import { RESOURCE_DRAWER_EXTENSION_POINT_ID } from '../drawer/extensionPoint';
import { registerDiagnosticRuntime } from './runtimeIdentity';

type DiagnosticsRequest = {
  requestId: string;
  windowName: string;
  operation: 'snapshot' | 'lookup';
  options?: DiagnosticFilter & { includeSensitive?: boolean; resourceKey?: string };
};
const activeCleanups = new Set<() => void>();
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    for (const cleanup of activeCleanups) {
      cleanup();
    }

    activeCleanups.clear();
  });
}

export function ExtensionDiagnosticsBridge() {
  const { capture, lookup, windowName } = useExtensionDiagnostics();
  useEffect(() => {
    const unregister = registerDiagnosticRuntime(ExtensionDiagnosticsClient);
    const cleanup = () => {
      unregister();
      activeCleanups.delete(cleanup);
    };

    activeCleanups.add(cleanup);
    return cleanup;
  }, []);
  useEffect(() => {
    if (!windowName) {
      return;
    }

    let mounted = true;
    const off = Events.On('extensions/diagnostics/request', event => {
      const request = event.data as DiagnosticsRequest | undefined;
      if (!mounted || request?.windowName !== windowName || typeof request.requestId !== 'string') {
        return;
      }

      if (request.requestId.length > 128) {
        return;
      }

      let payload = '';
      let errorMessage = '';
      try {
        const options = request.options ?? {};
        if (request.operation === 'snapshot') {
          payload = JSON.stringify(filterExtensionSnapshot(capture(options.includeSensitive === true), options));
        } else if (request.operation === 'lookup') {
          if (typeof options.pointId !== 'string' || typeof options.pluginId !== 'string' || typeof options.resourceKey !== 'string') {
            throw new Error('Invalid lookup request');
          }

          if (options.pointId !== RESOURCE_SIDEBAR_EXTENSION_POINT_ID && options.pointId !== RESOURCE_DRAWER_EXTENSION_POINT_ID) {
            errorMessage = 'unsupported-context';
          } else {
            payload = JSON.stringify(lookup({ pointId: options.pointId, pluginId: options.pluginId, resourceKey: options.resourceKey }));
          }
        } else {
          throw new Error('Unsupported diagnostic operation');
        }

        if (new TextEncoder().encode(payload).byteLength > 1_000_000) {
          payload = '';
          errorMessage = 'Diagnostic payload exceeds the response limit.';
        }
      } catch {
        errorMessage = 'Extension diagnostics request failed. Check lookup support and required identifiers; exception details are redacted.';
      }

      // Expired broker requests are expected during cancellation or window teardown.
      void ExtensionDiagnosticsClient.Respond(request.requestId, windowName, payload, errorMessage).catch(() => undefined);
    });
    const cleanup = () => {
      if (!mounted) {
        return;
      }

      mounted = false;
      off();

      activeCleanups.delete(cleanup);
    };

    activeCleanups.add(cleanup);
    return cleanup;
  }, [capture, lookup, windowName]);
  return null;
}
