import { execFileSync } from 'node:child_process';
import {
  closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync,
  statSync, watch,
} from 'node:fs';
import type { BigIntStats, FSWatcher } from 'node:fs';
import type { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import type { Duplex } from 'node:stream';

type FeedbackContext = {
  schemaVersion: 1;
  workspaceID: string;
  generation: string;
  workspaceRoot: string;
  file: string;
  authority?: {
    executable: string;
    identity: { volume: string; fileID: string };
  };
};

type FeedbackChannel = {
  send(payload: unknown, data?: unknown): void;
};

// The common server surface deliberately avoids tying the host's Vite 8
// configuration to the plugin package's Vite 5 Plugin/ViteDevServer types.
type ManagedFeedbackServer = {
  config: { server: { port?: number; hmr?: boolean | { server?: EventEmitter; port?: number } } };
  httpServer: EventEmitter | null;
  ws: FeedbackChannel & { readonly clients: { readonly size: number } };
  middlewares: {
    use(handler: (request: IncomingMessage, response: ServerResponse, next: () => void) => void): unknown;
  };
  environments?: Record<string, { hot: FeedbackChannel }>;
  close(): Promise<void>;
};

type UpgradeHandler = (request: IncomingMessage, socket: Duplex, head: Uint8Array) => void;
const navigationTypes: Record<string, true> = { update: true, 'full-reload': true, prune: true };
const maximumStateBytes = 64 * 1024;
const maximumStateSize = BigInt(maximumStateBytes);

function feedbackContext(raw: string): FeedbackContext {
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('OMNIVIEW_VITE_FEEDBACK must be an explicit managed feedback context');
  }

  const context = value as Record<string, unknown>;
  if (context.schemaVersion !== 1
    || typeof context.workspaceID !== 'string'
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(context.workspaceID)
    || typeof context.generation !== 'string' || !context.generation || context.generation.includes('\0')
    || typeof context.workspaceRoot !== 'string' || !path.isAbsolute(context.workspaceRoot)
    || context.workspaceRoot.includes('\0') || path.parse(context.workspaceRoot).root === context.workspaceRoot
    || typeof context.file !== 'string' || !path.isAbsolute(context.file)
    || context.file.includes('\0') || path.resolve(context.file) !== context.file) {
    throw new Error('Managed Vite feedback requires versioned, explicit workspace and file ownership');
  }

  if (realpathSync(context.workspaceRoot) !== context.workspaceRoot || !statSync(context.workspaceRoot).isDirectory()) {
    throw new Error('Managed Vite feedback workspace must be an existing canonical directory');
  }

  let authority: FeedbackContext['authority'];
  if (context.authority !== undefined) {
    if (!context.authority || typeof context.authority !== 'object' || Array.isArray(context.authority)) {
      throw new Error('Managed Vite feedback authority must be explicit supervisor ownership');
    }

    const value = context.authority as Record<string, unknown>;
    if (typeof value.executable !== 'string' || !path.isAbsolute(value.executable)
      || value.executable.includes('\0') || path.resolve(value.executable) !== value.executable
      || realpathSync(value.executable) !== value.executable || !lstatSync(value.executable).isFile()
      || !value.identity || typeof value.identity !== 'object' || Array.isArray(value.identity)) {
      throw new Error('Managed Vite feedback authority requires its exact canonical supervisor executable');
    }

    const identity = value.identity as Record<string, unknown>;
    if (typeof identity.volume !== 'string' || !/^[0-9]+$/.test(identity.volume)
      || typeof identity.fileID !== 'string' || !/^[0-9a-f]{32}$/.test(identity.fileID)) {
      throw new Error('Managed Vite feedback authority requires the full stable file identity');
    }

    authority = {
      executable: value.executable,
      identity: { volume: identity.volume, fileID: identity.fileID },
    };
  }

  return {
    schemaVersion: 1,
    workspaceID: context.workspaceID,
    generation: context.generation,
    workspaceRoot: context.workspaceRoot,
    file: context.file,
    authority,
  };
}

/** Windows delegates SID/DACL and full file-ID checks to the same owned CLI. */
export function readViteFeedbackAuthority(raw: string): boolean {
  try {
    const context = feedbackContext(raw);
    if (!context.authority) {
      return true;
    }

    const output = execFileSync(context.authority.executable, ['vite-feedback-read', '--context', raw], {
      encoding: 'utf8',
      shell: false,
      windowsHide: true,
      timeout: 2000,
      maxBuffer: 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const result: unknown = JSON.parse(output);
    if (!result || typeof result !== 'object' || Array.isArray(result)
      || Object.keys(result).length !== 1) {
      return true;
    }

    return (result as Record<string, unknown>).held !== false;
  } catch {
    return true;
  }
}

type FeedbackAuthorityReader = {
  initiallyHeld: boolean;
  readHeld(): boolean;
};

function privateFeedbackFile(stat: BigIntStats): boolean {
  const owner = process.getuid?.();
  return stat.isFile() && owner !== undefined && stat.uid === BigInt(owner)
    && (stat.mode & 0o777n) === 0o600n;
}

/** Retain the selected Unix inode; no subsequent read may adopt a replacement. */
function retainUnixFeedbackAuthority(context: FeedbackContext): FeedbackAuthorityReader {
  const bytes = Buffer.alloc(maximumStateBytes + 1);
  let identity: BigIntStats | undefined;

  function readHeld(captureIdentity = false): boolean {
    // Identity is captured only by the initial read below, even if it fails.
    let descriptor: number | undefined;
    try {
      // O_NONBLOCK also prevents an untrusted FIFO replacement from hanging Vite.
      descriptor = openSync(context.file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      const stat = fstatSync(descriptor, { bigint: true });
      if (!privateFeedbackFile(stat) || realpathSync(context.file) !== context.file) {
        return true;
      }

      if (captureIdentity) {
        identity = stat;
      }

      if (!identity || stat.dev !== identity.dev || stat.ino !== identity.ino) {
        return true;
      }

      const linked = lstatSync(context.file, { bigint: true });
      if (!privateFeedbackFile(linked) || linked.dev !== identity.dev || linked.ino !== identity.ino
        || stat.size < 1n || stat.size > maximumStateSize) {
        return true;
      }

      const length = readSync(descriptor, bytes, 0, bytes.length, 0);
      if (BigInt(length) !== stat.size) {
        return true;
      }

      const state: unknown = JSON.parse(bytes.toString('utf8', 0, length));
      if (!state || typeof state !== 'object' || Array.isArray(state)) {
        return true;
      }

      const value = state as Record<string, unknown>;
      const after = lstatSync(context.file, { bigint: true });
      return !privateFeedbackFile(after) || after.dev !== identity.dev || after.ino !== identity.ino
        || value.schemaVersion !== context.schemaVersion || value.workspaceID !== context.workspaceID
        || value.generation !== context.generation || value.workspaceRoot !== context.workspaceRoot
        || typeof value.held !== 'boolean' || value.held;
    } catch {
      // A partial durable publication, missing path, or foreign file never releases.
      return true;
    } finally {
      if (descriptor !== undefined) {
        closeSync(descriptor);
      }
    }
  }

  return { initiallyHeld: readHeld(true), readHeld };
}

function feedbackAuthorityReader(context: FeedbackContext, raw: string): FeedbackAuthorityReader {
  if (process.platform !== 'win32') {
    return retainUnixFeedbackAuthority(context);
  }

  return {
    initiallyHeld: readViteFeedbackAuthority(raw),
    readHeld: () => readViteFeedbackAuthority(raw),
  };
}

/** Attach only to the explicitly selected child; ordinary Vite is unchanged. */
export function attachManagedViteFeedback(server: ManagedFeedbackServer, raw = process.env.OMNIVIEW_VITE_FEEDBACK): void {
  if (raw === undefined) {
    return;
  }

  const context = feedbackContext(raw);
  if (process.platform === 'win32' && !context.authority) {
    throw new Error('Managed Vite feedback on Windows requires its supervisor file authority');
  }

  const httpServer = server.httpServer;
  const hmr = typeof server.config.server.hmr === 'object' ? server.config.server.hmr : undefined;
  if (!httpServer || Boolean(hmr?.server && hmr.server !== httpServer)
    || Boolean(hmr?.port && hmr.port !== server.config.server.port)) {
    throw new Error('Managed Vite feedback requires HMR on its owned HTTP listener');
  }

  const authority = feedbackAuthorityReader(context, raw);
  let closed = false;
  let watchFailed = false;
  let watcher: FSWatcher | undefined;
  let held = authority.initiallyHeld;
  const pendingPings = new Set<ServerResponse>();

  function readHeld(): boolean {
    return closed || watchFailed || authority.readHeld();
  }

  const originalWebSocketSend = server.ws.send;

  function reloadConnectedConsumers() {
    // Vite 8 buffers a reload without recipients, then replays it directly
    // on a later connection without passing through the feedback channels.
    if (server.ws.clients.size > 0) {
      originalWebSocketSend.call(server.ws, { type: 'full-reload', path: '*' });
    }
  }

  function releasePendingHTTPPings(): 'held' | 'released' {
    for (const response of pendingPings) {
      held = readHeld();
      if (held) {
        return 'held';
      }

      pendingPings.delete(response);
      response.writeHead(204).end();
    }

    return 'released';
  }

  function refreshReadinessAndReleaseConsumers(): 'held' | 'released' | 'ready' {
    const previouslyHeld = held;
    held = readHeld();
    if (held) {
      return 'held';
    }

    if (!previouslyHeld) {
      return 'ready';
    }

    // Check again at publication, including when a watcher noticed the release.
    held = readHeld();
    if (held) {
      return 'held';
    }

    reloadConnectedConsumers();
    return releasePendingHTTPPings();
  }

  const environments = server.environments;
  // Vite 8 emits through environment.hot; Vite 5 also retains broadcaster
  // references to ws. Intercept both objects, not just one version's facade.
  const channels = new Set<FeedbackChannel>([server.ws]);
  for (const environment of Object.values(environments ?? {})) {
    channels.add(environment.hot);
  }

  for (const channel of channels) {
    const original = channel.send;
    channel.send = function (payload, data) {
      if (payload && typeof payload === 'object' && 'type' in payload
        && typeof payload.type === 'string' && navigationTypes[payload.type]) {
        // A release replaces queued/partial feedback with one complete reload.
        if (refreshReadinessAndReleaseConsumers() !== 'ready' || server.ws.clients.size === 0) {
          return;
        }
      }

      original.call(this, payload, data);
    };
  }

  server.middlewares.use((request, response, next) => {
    if (request.url === '/__omniview_development_status') {
      let fd: number | undefined;
      try {
        fd = openSync(path.join(context.workspaceRoot, '.local', 'launch-status.json'), constants.O_RDONLY | constants.O_NOFOLLOW);
        const stat = fstatSync(fd);
        if (!stat.isFile() || stat.size > 1024 * 1024
          || process.platform !== 'win32' && ((stat.mode & 0o077) !== 0
            || typeof process.getuid === 'function' && stat.uid !== process.getuid())) {
          throw new Error('Development status ownership changed');
        }

        const bytes = Buffer.alloc(stat.size);
        readSync(fd, bytes, 0, bytes.length, 0);
        const status = JSON.parse(bytes.toString('utf8'));
        if (status.generation !== context.generation || status.manifest?.workspaceID !== context.workspaceID) {
          throw new Error('Development status identity changed');
        }

        response.setHeader('Cache-Control', 'no-store');
        response.setHeader('Content-Type', 'application/json');
        response.end(JSON.stringify({
          phase: status.launchPhase,
          failedStage: status.failedStage,
          recoveryCommand: `omniview-dev workspace refresh ${context.workspaceID}`,
        }));
      } catch {
        response.writeHead(503).end();
      } finally {
        if (fd !== undefined) {
          closeSync(fd);
        }
      }

      return;
    }

    if (request.headers.accept !== 'text/x-vite-ping') {
      next(); return;
    }

    if (refreshReadinessAndReleaseConsumers() !== 'held') {
      response.writeHead(204).end();
      return;
    }

    // Any fulfilled fetch, even 503, counts as ready in the Vite 5 client.
    pendingPings.add(response);
    response.once('close', () => pendingPings.delete(response));
  });

  const upgradeHandlers = new Map<UpgradeHandler, UpgradeHandler>();
  for (const listener of httpServer.rawListeners('upgrade')) {
    const original = listener as UpgradeHandler;
    const gated: UpgradeHandler = function (this: EventEmitter, request, socket, head) {
      if (request.headers['sec-websocket-protocol'] === 'vite-ping') {
        if (refreshReadinessAndReleaseConsumers() === 'held') {
          socket.destroy();
          return;
        }
      }

      original.call(this, request, socket, head);
    };

    upgradeHandlers.set(original, gated);
    httpServer.off('upgrade', original);
    httpServer.on('upgrade', gated);
  }

  const originalClose = server.close;
  function cleanup() {
    if (closed) {
      return;
    }

    closed = true;
    watcher?.close();
    for (const response of pendingPings) {
      response.destroy();
    }

    pendingPings.clear();
    for (const [original, gated] of upgradeHandlers) {
      httpServer!.off('upgrade', gated);
      httpServer!.on('upgrade', original);
    }

    httpServer!.off('close', cleanup);
    server.close = originalClose;
  }

  server.close = async function () {
    cleanup();
    await originalClose.call(this);
  };

  httpServer.once('close', cleanup);
  try {
    // Publication extends this retained inode with WriteAt; it need not change
    // a directory entry. Watch the file itself so a release wakes pending pings.
    // Refresh still verifies the canonical path and captured inode before use.
    watcher = watch(context.file, { persistent: false }, () => {
      refreshReadinessAndReleaseConsumers(); 
    });
    watcher.on('error', () => {
      watchFailed = true; held = true; 
    });
    // Cover a release between the initial read and installing the native watch.
    refreshReadinessAndReleaseConsumers();
  } catch {
    watchFailed = true;
    held = true;
  }
}

/** Shared host entry point; plugin Vite attaches the identical barrier itself. */
export function managedViteFeedback() {
  return {
    name: 'omniview-managed-vite-feedback',
    apply: 'serve' as const,
    enforce: 'pre' as const,
    transformIndexHtml() {
      if (!process.env.OMNIVIEW_VITE_FEEDBACK) {
        return [];
      }

      return [{
        tag: 'script',
        attrs: { type: 'module' },
        injectTo: 'body' as const,
        children: `
const banner = document.createElement('div');
banner.id = 'omniview-development-banner';
banner.setAttribute('role', 'status');
banner.style.cssText = 'position:fixed;bottom:32px;left:12px;max-width:calc(100vw - 24px);box-sizing:border-box;pointer-events:none;z-index:2147483647;padding:6px 12px;background:#172554;color:#fff;font:12px monospace;white-space:pre-wrap';
document.body.append(banner);
async function refreshDevelopmentStatus() {
  try {
    const response = await fetch('/__omniview_development_status', { cache: 'no-store' });
    if (!response.ok) throw new Error('status unavailable');
    const status = await response.json();
    banner.textContent = 'DEVELOPMENT — ' + status.phase + (status.failedStage ? ' — failed stage: ' + status.failedStage + ' — recover: ' + status.recoveryCommand : '');
  } catch {
    banner.textContent = 'DEVELOPMENT — supervisor status unavailable; inspect workspace status before trusting served source';
  }
}
refreshDevelopmentStatus();
setInterval(refreshDevelopmentStatus, 1500);
`,
      }];
    },
    configureServer(server: ManagedFeedbackServer) {
      attachManagedViteFeedback(server);
    },
  };
}
