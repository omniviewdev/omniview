import { execFile } from 'node:child_process';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer as createPortServer, type Server as PortLease } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { build as bundleGenerator } from 'esbuild';
import { createServer as createHost, version as hostVersion } from 'vite';
import type { ViteDevServer } from 'vite';
import { build, createServer, version as pluginVersion } from '../../../packages/omniviewdev-vite-plugin/node_modules/vite/dist/node/index.js';
import { omniviewExternals } from '../../../packages/omniviewdev-vite-plugin/src/index';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const pluginRoot = path.join(repo, 'packages/omniviewdev-vite-plugin');
const run = promisify(execFile);
const baselineColor = 'rgb(31, 72, 113)';
type Server = Pick<ViteDevServer, 'httpServer' | 'close'>;
type Delivery = 'stylesheet-link' | 'live-import';

type Resources = {
  root: string;
  servers: Set<Server>;
  leases: Map<number, PortLease>;
  env: NodeJS.ProcessEnv;
  close: () => Promise<void>;
};

async function put(file: string, contents: string) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, contents);
}


async function resources() {
  if (!hostVersion.startsWith('8.') || !pluginVersion.startsWith('5.')) {
    throw new Error(`Expected the pinned real Vite 8 host and Vite 5 plugin, got ${hostVersion}/${pluginVersion}`);
  }
  const root = process.env.OMNIVIEW_PUBLISHED_ROOT;
  if (!root) throw new Error('Producer requires its controller-owned private root');
  const servers = new Set<Server>();
  const leases = new Map<number, PortLease>();
  const env = { ...process.env };
  const close = async () => {
    const results = await Promise.allSettled([
      ...[...servers].map(server => server.close()),
      ...[...leases.values()].map(listener => closeLease(listener)),
    ]);
    const failures = results.filter(result => result.status === 'rejected');
    const listening = [...servers].filter(server => server.httpServer?.listening);
    if (failures.length || listening.length) {
      throw new AggregateError(failures.map(result => result.reason), `Owned Vite teardown failed; retain ${root}`);
    }
    servers.clear();
    leases.clear();
    // Root retirement belongs to the controller, after this entire producer
    // process AND its native compiler process group are proven exited.
  };
  return { root, servers, leases, env, close };
}

async function allocatePort(r: Resources) {
  // A lease owns only the address, not an HTTP/HMR endpoint. Browser reconnects
  // must not leave accepted sockets that make net.Server.close() wait forever.
  const listener = createPortServer(socket => socket.destroy());
  const started = Promise.withResolvers<void>();
  listener.once('error', started.reject);
  listener.listen({ host: '127.0.0.1', port: 0, exclusive: true }, started.resolve);
  await started.promise;
  const address = listener.address();
  if (!address || typeof address === 'string') throw new Error('Ephemeral listener has no TCP address');
  const selected = address.port;
  // Keep every reservation bound while both complete input trees are written.
  // Release only immediately before that exact Vite listener's strict bind.
  r.leases.set(selected, listener);
  // The subsequent strict bind fails on a race; never adopt another listener,
  // retry another port, or fall back to Vite's shared default port.
  return selected;
}

function closeLease(listener: PortLease) {
  const stopped = Promise.withResolvers<void>();
  listener.close(error => error ? stopped.reject(error) : stopped.resolve());
  return stopped.promise;
}

async function releasePort(r: Resources, selected: number) {
  const listener = r.leases.get(selected);
  if (!listener) throw new Error(`Missing owned port reservation ${selected}`);
  await closeLease(listener);
  r.leases.delete(selected);
}

function watcherReady(watcher: {
  _readyEmitted?: boolean;
  once(event: string, listener: () => void): unknown;
  off(event: string, listener: () => void): unknown;
}) {
  // Both pinned Vite majors use Chokidar's persistent readiness bit. Server
  // construction awaits plugin/environment initialization after starting the
  // watcher, so the one-shot event can precede createServer()'s return.
  if (typeof watcher._readyEmitted !== 'boolean') {
    throw new Error('Pinned Vite watcher does not expose its actual readiness state');
  }
  const ready = Promise.withResolvers<void>();
  watcher.once('ready', ready.resolve);
  if (watcher._readyEmitted) ready.resolve();
  return ready.promise.finally(() => watcher.off('ready', ready.resolve));
}

function common(root: string) {
  return {
    root, configFile: false as const, envFile: false as const, logLevel: 'error' as const,
    cacheDir: path.join(root, '.vite'), optimizeDeps: { noDiscovery: true, include: [] },
    server: { host: '127.0.0.1', strictPort: true, fs: { allow: [root, repo] } },
  };
}

async function startPlugin(r: Resources, root: string, ownedPort: number, shimsDir?: string) {
  const options = common(root);
  const server = await createServer({ ...options, plugins: [omniviewExternals({ shimsDir })],
    server: { ...options.server, port: ownedPort, fs: { allow: [r.root, repo] }, cors: true } });
  r.servers.add(server);
  await watcherReady(server.watcher);
  await releasePort(r, ownedPort);
  await server.listen();
  return server;
}

async function startHost(r: Resources, root: string, ownedPort: number) {
  const options = common(root);
  const server = await createHost({ ...options,
    server: { ...options.server, port: ownedPort, fs: { allow: [r.root, repo] } } });
  r.servers.add(server);
  await watcherReady(server.watcher);
  await releasePort(r, ownedPort);
  await server.listen();
  return server;
}

function html(head = '') {
  return `<!doctype html><html><head>${head}</head><body><button id="host" class="published-control">host</button><button id="served">pending</button><button id="production">pending</button><output id="identity"></output><output id="new-export"></output><script type="module" src="/main.ts"></script></body></html>`;
}

async function runtimeConsumer(r: Resources, name: string, generator: string, manifest: string) {
  const root = path.join(r.root, name);
  const host = path.join(root, 'host');
  const plugin = path.join(root, 'plugin');
  const packageRoot = path.join(root, 'node_modules/@omniviewdev/runtime');
  const shims = path.join(root, 'shims');
  const runtimeSource = path.join(root, 'runtime/index.ts');
  let hostServer: Server | undefined;
  let pluginServer: Server | undefined;
  const hostPort = await allocatePort(r);
  const pluginPort = await allocatePort(r);
  await put(path.join(packageRoot, 'package.json'), manifest);
  await put(path.join(host, 'index.html'), html());
  // Bundle the unmodified production script, so its dynamic package imports
  // resolve against this disposable publication, not the repository runtime.
  await put(path.join(root, 'package.json'), '{"type":"module","private":true}');
  await cp(generator, path.join(root, 'generate-shims.mjs'));

  const materialize = async (revised: boolean) => {
    await put(runtimeSource, `export function runtimeLabel(who: string): string { return ${JSON.stringify(revised ? 'revised:' : 'baseline:')} + who; }\n${revised ? 'export function newlyPublishedLabel(who: string): string { return runtimeLabel(who) + ":fresh"; }' : ''}\n`);
    // Same relevant production producer as runtime/vite.config.ts: a typed
    // library entry compiled by Vite 5 to published ES modules. No React/dts or
    // unrelated runtime graph is needed by this dependency-free entry.
    await build({
      ...common(path.dirname(runtimeSource)),
      build: { outDir: path.join(packageRoot, 'dist'), emptyOutDir: true, minify: false,
        lib: { entry: runtimeSource, name: '@omniview/runtime', formats: ['es'], fileName: () => 'index.js' } },
    });
    for (const subpath of ['api', 'models', 'runtime']) {
      await cp(path.join(packageRoot, 'dist/index.js'), path.join(packageRoot, `dist/${subpath}.js`));
    }
    await run(process.execPath, [path.join(root, 'generate-shims.mjs')], {
      cwd: root, env: { ...r.env, OMNIVIEW_SHIMS_OUTPUT_DIRECTORY: shims, OMNIVIEW_SHIMS_SOURCE_DIRECTORY: shims },
      timeout: 10_000, maxBuffer: 64 * 1024,
    });
    const symbol = revised ? 'newlyPublishedLabel' : 'runtimeLabel';
    await put(path.join(plugin, 'consumer.ts'), `import { ${symbol} } from '@omniviewdev/runtime';\nexport const sharedFunction = ${symbol};\nexport const served = ${symbol}('served');\n`);
    await put(path.join(plugin, 'production.ts'), `import { ${symbol} } from '@omniviewdev/runtime';\nexport const sharedFunction = ${symbol};\nexport const production = ${symbol}('production');\n`);
    // This is the actual production format and externalization adapter, not an
    // ES shim bundled into the artifact or a hand-authored registry function.
    await build({ ...common(plugin), plugins: [omniviewExternals({ shimsDir: shims })],
      build: { outDir: path.join(host, 'production'), emptyOutDir: true, minify: false,
        rollupOptions: { input: path.join(plugin, 'production.ts'), preserveEntrySignatures: 'strict',
          output: { format: 'system', entryFileNames: 'plugin.js', inlineDynamicImports: true } } },
    });
    await put(path.join(host, 'main.ts'), `
import * as runtime from '../node_modules/@omniviewdev/runtime/dist/index.js';
import { buildImportMap } from ${JSON.stringify(`/@fs/${path.join(repo, 'ui/features/plugins/api/utils.ts')}`)};
import { systemJs } from ${JSON.stringify(`/@fs/${path.join(repo, 'ui/features/plugins/api/systemjs.ts')}`)};
const registry = { '@omniviewdev/runtime': runtime };
window.__OMNIVIEW_SHARED__ = registry;
systemJs.addImportMap({ imports: buildImportMap(registry) });
const served = await import(/* @vite-ignore */ ${JSON.stringify(`http://127.0.0.1:${pluginPort}/consumer.ts`)});
const production = await systemJs.import('/production/plugin.js');
document.querySelector('#host').textContent = runtime.${symbol}('host');
document.querySelector('#served').textContent = served.served;
document.querySelector('#production').textContent = production.production;
document.querySelector('#identity').textContent = served.sharedFunction === runtime.${symbol} && production.sharedFunction === runtime.${symbol} ? 'shared functions' : 'duplicated functions';
document.querySelector('#new-export').textContent = typeof runtime.newlyPublishedLabel === 'function' ? 'present' : 'absent';
`);
  };
  const start = async () => {
    pluginServer = await startPlugin(r, plugin, pluginPort, shims);
    hostServer = await startHost(r, host, hostPort);
  };
  await materialize(false);
  return {
    url: `http://127.0.0.1:${hostPort}`, ports: [hostPort, pluginPort], start,
    publishNewExport: async () => {
      for (const server of [hostServer, pluginServer]) {
        if (server) {
          await server.close();
          r.servers.delete(server);
        }
      }
      // The same strict endpoints are re-reserved before publishing replacement
      // inputs; B remains running against its independently owned input tree.
      for (const selected of [hostPort, pluginPort]) {
        const listener = createPortServer(socket => socket.destroy());
        const bound = Promise.withResolvers<void>();
        listener.once('error', bound.reject);
        listener.listen({ host: '127.0.0.1', port: selected, exclusive: true }, bound.resolve);
        await bound.promise;
        r.leases.set(selected, listener);
      }
      await materialize(true);
      await start();
    },
  };
}

export async function publishedRuntime() {
  const r = await resources();
  try {
    const generator = path.join(r.root, 'generate-shims.mjs');
    await bundleGenerator({ entryPoints: [path.join(pluginRoot, 'scripts/generate-shims.ts')],
      bundle: true, platform: 'node', format: 'esm', target: 'node24', outfile: generator, logLevel: 'silent' });
    const manifest = await readFile(path.join(repo, 'packages/omniviewdev-runtime/package.json'), 'utf8');
    const a = await runtimeConsumer(r, 'a', generator, manifest);
    const b = await runtimeConsumer(r, 'b', generator, manifest);
    // No Vite watcher sees input construction for either independent consumer.
    await a.start();
    await b.start();
    return { a, b, ports: [...a.ports, ...b.ports], close: r.close };
  } catch (error) {
    await r.close();
    throw error;
  }
}

async function styleConsumer(r: Resources, name: string, delivery: Delivery) {
  const root = path.join(r.root, name);
  const host = path.join(root, 'host');
  const plugin = path.join(root, 'plugin');
  const source = path.join(root, 'ui-source/styles.css');
  const publication = path.join(host, 'published/base-ui');
  const hostPort = await allocatePort(r);
  const pluginPort = await allocatePort(r);
  // A real CSS-only package with the same public stylesheet entry as base-ui.
  // The host consumes its published export target, never the editable source.
  // Keeping the publication outside node_modules is intentional: Vite ignores
  // node_modules watches. No package aliases or per-plugin dependency links.
  const baseManifest = JSON.parse(await readFile(path.join(repo, 'node_modules/@omniviewdev/base-ui/package.json'), 'utf8')) as { name: string; version: string };
  await put(path.join(publication, 'package.json'), JSON.stringify({ name: baseManifest.name, version: baseManifest.version, type: 'module', exports: { './styles.css': './dist/styles.css' } }));
  const publishCSS = async (color: string) => {
    await put(source, `.published-control { background-color: ${color}; color: white; }\n`);
    // Vite's CSS producer performs actual parsing/build/publication. The live
    // server watches the resulting artifact, not the editable source fixture.
    await build({ ...common(path.dirname(source)), build: { outDir: path.join(publication, 'dist'), emptyOutDir: false, minify: false,
      rollupOptions: { input: source, output: { assetFileNames: 'styles.css' } } } });
  };
  await publishCSS(baselineColor);
  await put(path.join(plugin, 'consumer.ts'), `export function mount() { const button = document.createElement('button'); button.id = 'plugin'; button.className = 'published-control'; button.textContent = 'plugin'; document.body.append(button); }`);
  const stylesheet = '/published/base-ui/dist/styles.css';
  await put(path.join(host, 'index.html'), html(delivery === 'stylesheet-link' ? `<link rel="stylesheet" href="${stylesheet}">` : ''));
  await put(path.join(host, 'main.ts'), `${delivery === 'live-import' ? `import ${JSON.stringify(stylesheet)};` : ''}
document.documentElement.dataset.documentId = crypto.randomUUID();
const plugin = await import(/* @vite-ignore */ ${JSON.stringify(`http://127.0.0.1:${pluginPort}/consumer.ts`)});
plugin.mount();
`);
  return { url: `http://127.0.0.1:${hostPort}`, ports: [hostPort, pluginPort], publishCSS,
    start: async () => {
      await startPlugin(r, plugin, pluginPort);
      await startHost(r, host, hostPort);
    } };
}

export async function publishedStyles(delivery: Delivery) {
  const r = await resources();
  try {
    const a = await styleConsumer(r, 'a', delivery);
    const b = await styleConsumer(r, 'b', delivery);
    await a.start();
    await b.start();
    return { a, b, ports: [...a.ports, ...b.ports], close: r.close };
  } catch (error) {
    await r.close();
    throw error;
  }
}
