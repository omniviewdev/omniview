import { Call } from '@omniviewdev/runtime/runtime';
import type { CancellablePromise } from '@wailsio/runtime';
import type { ResourceShellFrame, ResourceShellTransport } from '../../shell/panel/terminal/resourceShellFeed';

const service = 'github.com/omniviewdev/omniview/backend/pkg/plugin/exec.ServiceWrapper';
async function receive<T>(method: 'ReadResourceShell' | 'CheckResourceShell', signal: AbortSignal, ...args: string[]): Promise<T> {
  signal.throwIfAborted();
  const call: CancellablePromise<T> = Call.ByName(`${service}.${method}`, ...args);
  const cancel = () => {
    void call.cancel().catch(() => undefined);
  };

  signal.addEventListener('abort', cancel, { once: true });
  try {
    return await call;
  } finally {
    signal.removeEventListener('abort', cancel);
  }
}

/** Only the host feed uses these calls. The exec stream is private in native windows and browser-backed windows alike. */
export const resourceShellTransport: ResourceShellTransport = {
  create: async (owner, request) => Call.ByName(`${service}.CreateResourceShell`, owner, request),
  read: async (id, lease, signal) => receive<ResourceShellFrame>('ReadResourceShell', signal, id, lease),
  check: async (id, lease, encodedRoot, signal) => receive<boolean>('CheckResourceShell', signal, id, lease, encodedRoot),
  write: async (id, lease, data) => Call.ByName(`${service}.WriteResourceShell`, id, lease, data),
  resize: async (id, lease, rows, cols) => Call.ByName(`${service}.ResizeResourceShell`, id, lease, rows, cols),
  close: async (id, lease) => Call.ByName(`${service}.CloseResourceShell`, id, lease),
};
