import { existsSync, realpathSync } from 'node:fs';
import { lstat, mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { OutputAsset, OutputBundle } from 'rollup';
import type { Plugin, ResolvedConfig } from 'vite';
import { configureWorkspaceOutput } from '../workspace';

const manifest = 'extensions.v1.json';
const modules = ['extensions.js', 'views.js'] as const;
const reserved = [manifest, ...modules];
const emptyEntry = '\0omniview:route-less-extension';

function removeBundleFile(bundle: OutputBundle, fileName: string): void {
  if (!Reflect.deleteProperty(bundle, fileName)) {
    throw new TypeError(`Could not remove ${fileName} from the Rollup bundle`);
  }
}

/** Stage all bytes before touching the old build. Withdraw its manifest first and publish the new one last.
 * Each rename is atomic within the output filesystem. A failed update cannot advertise half-written modules. */
async function publish(outDir: string, assets: ReadonlyMap<string, string>, removePage: boolean, keep: ReadonlySet<string>): Promise<void> {
  const dir = path.join(outDir, 'assets');
  if (assets.size) {
    await mkdir(dir, { recursive: true });
  } else if (!existsSync(dir)) {
    return;
  }

  if (!(await lstat(dir)).isDirectory()) {
    throw new Error('Expected an assets directory inside the configured Vite output');
  }

  if (!assets.size && !reserved.some(name => !keep.has(`assets/${name}`) && existsSync(path.join(dir, name)))) {
    return;
  }

  const stage = assets.size ? await mkdtemp(path.join(dir, '.extensions-v1-')) : undefined;
  try {
    if (stage) {
      for (const [name, bytes] of assets) {
        await writeFile(path.join(stage, name), bytes, { flag: 'wx' });
      }
    }

    if (!keep.has(`assets/${manifest}`)) {
      await rm(path.join(dir, manifest), { force: true });
    }

    for (const name of modules) {
      if (stage && assets.has(name)) {
        await rename(path.join(stage, name), path.join(dir, name));
      } else if (!keep.has(`assets/${name}`)) {
        await rm(path.join(dir, name), { force: true });
      }
    }

    if (removePage) {
      for (const name of ['entry.js', 'entry.js.map']) {
        await rm(path.join(dir, name), { force: true });
      }
    }

    if (stage && assets.has(manifest)) {
      await rename(path.join(stage, manifest), path.join(dir, manifest));
    }
  } finally {
    if (stage) {
      await rm(stage, { recursive: true, force: true });
    }
  }
}

/** Compile ui/src/extension.ts and its declared roles. No descriptor means ordinary Vite page behavior. */
export function omniviewExtensionsV1(): Plugin {
  let config: ResolvedConfig;
  let assets = new Map<string, string>();
  let routeLess = false;
  const staged = new WeakMap<OutputBundle, OutputAsset[]>();
  return {
    name: 'omniview-extensions-v1', apply: 'build', enforce: 'post',
    config(user) {
      const root = path.resolve(user.root ?? process.cwd());
      if (!existsSync(path.join(root, 'src/extension.ts'))) {
        return;
      }

      configureWorkspaceOutput(user);
      const build = user.build ??= {}, rollup = build.rollupOptions ??= {};
      const page = path.join(root, 'src/entry.ts');
      if (existsSync(page)) {
        rollup.input ??= page;
        rollup.output ??= {};
        for (const output of Array.isArray(rollup.output) ? rollup.output : [rollup.output]) {
          output.format ??= 'system';
          output.entryFileNames ??= 'assets/entry.js';
        }

        rollup.preserveEntrySignatures ??= 'exports-only';
      } else {
        if (rollup.input && !(typeof rollup.input === 'string' && path.resolve(root, rollup.input) === page)) {
          throw new Error('Route-less extensions cannot replace another configured Vite entry');
        }

        rollup.input = emptyEntry;
      }
    },
    configResolved(resolved) {
      config = resolved;
    },
    resolveId(id) {
      if (id === emptyEntry) {
        return id;
      }
    },
    load(id) {
      if (id === emptyEntry) {
        return 'export {};';
      }
    },
    async buildStart() {
      const root = realpathSync(config.root), descriptor = path.join(root, 'src/extension.ts');
      this.addWatchFile(descriptor);
      assets = new Map();
      routeLess = false;
      if (!existsSync(descriptor)) {
        return;
      }

      routeLess = !existsSync(path.join(root, 'src/entry.ts'));
      if (config.publicDir && reserved.some(name => existsSync(path.join(config.publicDir, 'assets', name)))) {
        this.error('Extension assets are generated; remove hand-authored copies from public/assets');
      }

      // Loading the compiler here keeps normal page builds and dev servers off the TypeScript/Rollup compiler graph.
      const { prepareExtensions } = await import('./build');
      assets = await prepareExtensions(root, descriptor, !config.isProduction, file => {
        this.addWatchFile(file);
      });
    },
    generateBundle: { order: 'post', handler(_options, bundle, isWrite) {
      for (const [name, item] of Object.entries(bundle)) {
        if (item.type === 'chunk' && item.facadeModuleId === emptyEntry) {
          removeBundleFile(bundle, name);
          removeBundleFile(bundle, `${name}.map`);
        }
      }

      if (!assets.size) {
        return;
      }

      if (reserved.some(name => Object.hasOwn(bundle, `assets/${name}`))) {
        this.error('Page build collides with a fixed extension asset');
      }

      if (routeLess && Object.hasOwn(bundle, 'assets/entry.js')) {
        this.error('Unexpected page asset in route-less extension');
      }

      const pending: OutputAsset[] = [];
      for (const [name, source] of assets) {
        const fileName = `assets/${name}`;
        this.emitFile({ type: 'asset', fileName, source });
        if (isWrite) {
          const asset = bundle[fileName];
          if (asset?.type !== 'asset') {
            this.error('Rollup did not produce the fixed extension asset');
          }

          // Rollup would otherwise write each final pathname directly. Restore the real assets after atomic publication.
          pending.push(asset);
          removeBundleFile(bundle, fileName);
        }
      }

      if (isWrite) {
        staged.set(bundle, pending);
      }
    } },
    writeBundle: { order: 'post', async handler(output, bundle) {
      const dir = output.dir ?? path.resolve(config.root, config.build.outDir);
      await publish(dir, assets, routeLess, new Set(Object.keys(bundle)));
      for (const asset of staged.get(bundle) ?? []) {
        bundle[asset.fileName] = asset;
      }

      staged.delete(bundle);
    } },
  };
}
