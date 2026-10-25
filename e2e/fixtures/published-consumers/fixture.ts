import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

type Delivery = 'stylesheet-link' | 'live-import';
type Ready = { type: 'ready'; a: string; b: string; ports: number[] };
type Reply = { id?: number; type?: string; error?: string; ok?: boolean };
type Pending = { resolve: () => void; reject: (error: Error) => void; timer: NodeJS.Timeout };
const directory = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(directory, '../../..');

function groupExists(pid: number) {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false;
    throw error;
  }
}

async function groupExited(pid: number) {
  const deadline = Date.now() + 2_000;
  while (groupExists(pid)) {
    if (Date.now() >= deadline) throw new Error('Owned native compiler group has not exited');
    await delay(10);
  }
}

async function beforeDeadline<T>(operation: Promise<T>, milliseconds: number, message: string) {
  const deadline = Promise.withResolvers<T>();
  const timer = setTimeout(() => deadline.reject(new Error(message)), milliseconds);
  try {
    return await Promise.race([operation, deadline.promise]);
  } finally {
    clearTimeout(timer);
  }
}

async function producer(kind: 'runtime' | Delivery) {
  if (process.platform === 'win32') throw new Error('Published-consumer ownership requires POSIX process groups');
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'omniview-published-consumers-')));
  const home = path.join(root, 'home');
  await mkdir(home, { mode: 0o700 });
  const kubeconfig = path.join(home, 'empty-kubeconfig');
  await writeFile(kubeconfig, 'apiVersion: v1\nkind: Config\nclusters: []\ncontexts: []\nusers: []\n');
  const env: NodeJS.ProcessEnv = {
    PATH: path.dirname(process.execPath), HOME: home, USERPROFILE: home,
    TMPDIR: root, TMP: root, TEMP: root, GOWORK: 'off',
    XDG_CONFIG_HOME: path.join(home, 'config'), XDG_CACHE_HOME: path.join(home, 'cache'),
    XDG_DATA_HOME: path.join(home, 'data'), KUBECONFIG: kubeconfig,
    NODE_ENV: 'test', NO_COLOR: '1', OMNIVIEW_PUBLISHED_ROOT: root,
  };
  // Resolve the existing pinned loader; never install/link packages or start a
  // compiler service in the Playwright process just to bootstrap this child.
  const requirePlugin = createRequire(path.join(repo, 'packages/omniviewdev-vite-plugin/package.json'));
  const loader = pathToFileURL(requirePlugin.resolve('tsx')).href;
  // Node's typed stdio overloads cover three entries, not the fourth IPC entry.
  // The explicit pipe entries still guarantee both readable output streams.
  const child = spawn(process.execPath, ['--import', loader, path.join(directory, 'producer-worker.mjs'), kind], {
    cwd: repo, env, detached: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  }) as ChildProcessByStdio<null, Readable, Readable>;
  const ready = Promise.withResolvers<Ready>();
  const exited = Promise.withResolvers<{ code: number | null; signal: NodeJS.Signals | null }>();
  const pending = new Map<number, Pending>();
  let nextID = 0;
  let logs = '';
  const capture = (chunk: Buffer) => { logs = (logs + chunk.toString()).slice(-16_384); };
  child.stdout.on('data', capture);
  child.stderr.on('data', capture);
  const rejectPending = (error: Error) => {
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    pending.clear();
  };
  child.on('message', (message: Reply) => {
    if (message.type === 'ready') ready.resolve(message as Ready);
    else if (message.type === 'failed') ready.reject(new Error(message.error));
    else if (message.id !== undefined) {
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id);
      clearTimeout(request.timer);
      if (message.error) request.reject(new Error(message.error));
      else request.resolve();
    }
  });
  child.once('error', error => {
    ready.reject(error);
    rejectPending(error);
  });
  child.once('close', (code, signal) => {
    exited.resolve({ code, signal });
    const error = new Error(`Published-consumer producer exited (${code ?? signal})`);
    ready.reject(error);
    rejectPending(error);
  });
  const request = (action: 'export' | 'css' | 'close', color?: string) => {
    const id = ++nextID;
    const result = Promise.withResolvers<void>();
    const timer = setTimeout(() => {
      pending.delete(id);
      result.reject(new Error(`Published-consumer ${action} timed out`));
    }, 10_000);
    pending.set(id, { ...result, timer });
    child.send({ id, action, color }, error => {
      if (error) {
        pending.delete(id);
        clearTimeout(timer);
        result.reject(error);
      }
    });
    return result.promise;
  };
  let retired = false;
  const close = async () => {
    if (retired) return;
    let failure: unknown;
    try {
      if (child.connected) await request('close');
      const outcome = await beforeDeadline(exited.promise, 5_000, 'Owned producer did not exit after teardown');
      if (outcome.code !== 0) throw new Error(`Producer shutdown was not clean (${outcome.code ?? outcome.signal})`);
    } catch (error) {
      failure = error;
      // Only this detached, still-live owned child group may be signalled.
      // Never kill by port, scan ambient PIDs, or adopt a foreign process.
      if (child.pid && child.exitCode === null && child.signalCode === null) {
        try { process.kill(-child.pid, 'SIGTERM'); } catch (signalError) {
          if ((signalError as NodeJS.ErrnoException).code !== 'ESRCH') failure = signalError;
        }
      }
      await beforeDeadline(exited.promise, 2_000, 'Owned producer did not exit after termination')
        .catch(error => { failure ??= error; });
    }
    try {
      if (child.pid) await groupExited(child.pid);
      else throw new Error('Producer has no established owned process identity');
    } catch (error) {
      failure ??= error;
    }
    if (failure) throw new Error(`Published-consumer teardown failed; retained ${root}\n${String(failure)}\n${logs}`);
    // Both Node and every native compiler in its group have exited. Until this
    // point retain the handles and private root, including on failed close.
    pending.clear();
    retired = true;
    await rm(root, { recursive: true, force: true });
  };
  try {
    const initial = await beforeDeadline(ready.promise, 20_000, 'Published-consumer startup timed out');
    if (!child.pid) throw new Error('Producer has no owned process identity');
    return { root, pid: child.pid, ports: initial.ports, a: initial.a, b: initial.b, request, close };
  } catch (error) {
    try { await close(); } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], `Published-consumer startup failed; retained ${root}`);
    }
    throw error;
  }
}

export async function publishedRuntime() {
  const owned = await producer('runtime');
  return { root: owned.root, pid: owned.pid, ports: owned.ports,
    a: { url: owned.a, publishNewExport: () => owned.request('export') },
    b: { url: owned.b }, close: owned.close };
}

export async function publishedStyles(delivery: Delivery) {
  const owned = await producer(delivery);
  return { root: owned.root, pid: owned.pid, ports: owned.ports,
    a: { url: owned.a, publishCSS: (color: string) => owned.request('css', color) },
    b: { url: owned.b }, close: owned.close };
}
