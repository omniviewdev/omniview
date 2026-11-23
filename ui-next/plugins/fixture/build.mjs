// Builds the fixture plugin the way a plugin's own repository builds its UI, and writes it as an installed plugin directory (`plugin.yaml`, `assets/`).
//
//   node ui-next/plugins/fixture/build.mjs <plugins-directory>
//
// It is a separate Vite build with its own config, outside the host's bundle: SystemJS output, `assets/entry.js`, the React Compiler (every first-party
// plugin compiles with it, so the bundle imports `react/compiler-runtime`), unhashed chunk names and the CSS folded into the entry, as the five plugin
// repositories do (docs/ui-next/slices/n19-plugin-seam.md, 1.2). What differs is the list of externals: exactly the host's shared list for contract v1
// (`../loader/specifiers.ts`, read here by Node), and a build that imports anything else fails, so a bundle cannot quietly carry its own React.
//
// A plugin written by this build may also have a PROCESS (`writePlugin(root, id, binary)`): the Go program of `./process`, built once by `buildProcess` and installed as `bin/plugin` with the `settings`
// capability, which the SDK serves to every plugin. The seam check uses it to end a plugin's process from outside (scenario n); no plugin of `PLUGINS` has one unless a check asks.
//
// Four plugins come out of it, one per thing the host must handle:
//   fixture-a-ok       the healthy plugin: React and the kit are the host's
//   fixture-b-dup      the negative control: the same plugin with its OWN copy of the kit, whose `useTheme` has no provider and throws
//   fixture-c-old      a bundle of the old shell: it imports the old UI library, which the new shell does not serve, and must be refused unrun
//   fixture-d-missing  a plugin whose `assets/` holds no bundle
// A fifth plugin, `fixture-f-conn` (Seam Connections), is written only on request (`writeConnectionsPlugin`, see below): it has a process of its own, with a `resource` capability and two connections.
import { execFile } from 'node:child_process';
import { chmod, copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import react from '@vitejs/plugin-react';
import { build } from 'vite';
import { readDependencies } from '../loader/preflight.ts';
import { SHARED_SPECIFIERS_V1 } from '../loader/specifiers.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(here, '../../..');
const OLD_ENTRY = 'virtual:fixture-old-entry';

// What an old-shell bundle does: it imports the old UI library and acts the moment it is evaluated. The check reads the global to prove the host refused it first.
const OLD_SOURCE = `import { Button } from '@omniviewdev/base-ui';
window.__fixtureOldBundleRan = true;
export const plugin = { Button };
`;

// `rail` is what each plugin's entry in the window's rail says (the build writes it into the bundle, `define` below): its name and its place, so the two plugins that contribute can be told
// apart in the rail and are listed in the order they declare; `tool` is the label of the tool each brings to the bottom panel, so the two are told apart in its strip too.
export const PLUGINS = {
  'fixture-a-ok': { variant: 'ok', name: 'Seam Fixture', rail: { label: 'Seam Fixture', order: 10, tool: 'Streams' } },
  'fixture-b-dup': { variant: 'duplicate', name: 'Seam Fixture Copy', rail: { label: 'Seam Fixture Copy', order: 20, tool: 'Streams copy' } },
  'fixture-c-old': { variant: 'old', name: 'Seam Fixture Old' },
  'fixture-d-missing': { variant: 'missing', name: 'Seam Fixture Missing' },
};

// The connections plugin is NOT in `PLUGINS`, and `writeAll` does not write it: the seam check installs every plugin of `PLUGINS` in most scenarios and counts rail entries, palette sections and plugins, so a
// plugin added there would change what they see. It has a process (`./connections-process`, built by `buildConnectionsProcess`) with a `resource` capability and two connections (`north` and `south`), and a
// check that wants it writes it itself with `writeConnectionsPlugin(root, binary)` (scenario u of the seam check, `checkConnectionsAndHome`, does). Its bundle is `src/entry-connections.tsx`; the name of each row of its one page opens that item's Logs session in the host's panel.
export const CONNECTIONS_ID = 'fixture-f-conn';
const CONNECTIONS = { variant: 'connections', name: 'Seam Connections', rail: { label: 'Seam Connections', order: 30 } };

const bareName = (source) => (source.startsWith('@') ? source.split('/').slice(0, 2).join('/') : source.split('/')[0]);

/**
 * The one file the fixture takes from outside its own directory: the kit's synthetic feed (`src/logs.ts`), which gives its Logs sessions their lines. No entry of the kit exports it (it is development and
 * documentation only), so a plugin cannot import it by name; the fixture bundles the file itself, named here by path as the import writes it (no extension). It imports nothing at run time.
 */
const SYNTHETIC_FEED = path.resolve(here, '../../../packages/kit/src/components/LogView/syntheticFeed');

/** A build of a plugin imports its own files, the shared list and what it bundles on purpose: nothing from the host's tree, nothing else from node_modules. */
function sealed(allowedBundled) {
  return {
    name: 'fixture-sealed',
    enforce: 'pre',
    resolveId(source, importer) {
      if (importer === undefined || source.startsWith('\0') || source.startsWith('virtual:')) {
        return null;
      }

      if (source.startsWith('.') || path.isAbsolute(source)) {
        const target = path.resolve(path.dirname(importer), source);
        if (importer.startsWith(here + path.sep) && !target.startsWith(here + path.sep) && target !== SYNTHETIC_FEED) {
          this.error(`"${source}" in ${importer} leaves the plugin's own files`);
        }

        return null;
      }

      if (!SHARED_SPECIFIERS_V1.includes(source) && !allowedBundled.includes(bareName(source)) && !allowedBundled.includes(source)) {
        this.error(`"${source}" is neither on the shared list nor bundled on purpose`);
      }

      return null;
    },
  };
}

/** The plugin's CSS, folded into its entry inside the kit's plugin layer (below the kit's components, so it can never beat a kit part). */
function foldCssIntoLayer(id) {
  return {
    name: 'fixture-fold-css-into-layer',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const sheets = Object.values(bundle).filter((file) => file.type === 'asset' && file.fileName.endsWith('.css'));
      if (sheets.length === 0) {
        return;
      }

      const css = sheets.map((file) => String(file.source)).join('\n');
      for (const sheet of sheets) {
        delete bundle[sheet.fileName];
      }

      const entry = Object.values(bundle).find((file) => file.type === 'chunk' && file.isEntry);
      if (entry?.type !== 'chunk') {
        return;
      }

      const layered = `@layer ov.plugin {\n${css}\n}`;
      entry.code +=
        `\n;(function(){var id=${JSON.stringify(id)};var old=document.querySelector('style[data-omniview-plugin-css="'+id+'"]');if(old)old.remove();` +
        `var s=document.createElement('style');s.setAttribute('data-omniview-plugin-css',id);s.textContent=${JSON.stringify(layered)};document.head.appendChild(s);})();\n`;
    },
  };
}

function virtualOldEntry() {
  return {
    name: 'fixture-old-entry',
    resolveId: (source) => (source === OLD_ENTRY ? OLD_ENTRY : null),
    load: (id) => (id === OLD_ENTRY ? OLD_SOURCE : null),
  };
}

async function buildBundle(id, variant, directory, rail) {
  const old = variant === 'old';
  const bundled = variant === 'duplicate' ? ['@omniviewdev/kit'] : [];
  const external = old ? [...SHARED_SPECIFIERS_V1, '@omniviewdev/base-ui'] : SHARED_SPECIFIERS_V1.filter((specifier) => !bundled.includes(specifier));
  await build({
    root: here,
    configFile: false,
    logLevel: 'warn',
    define: { FIXTURE_RAIL: JSON.stringify(rail ?? null) },
    plugins: [
      virtualOldEntry(),
      react({ babel: { plugins: [['babel-plugin-react-compiler', { target: '19' }]] } }),
      sealed(old ? ['@omniviewdev/base-ui'] : bundled),
      foldCssIntoLayer(id),
    ],
    build: {
      outDir: directory,
      emptyOutDir: false,
      cssCodeSplit: false,
      sourcemap: false,
      rollupOptions: {
        input: old ? OLD_ENTRY : path.join(here, variant === 'connections' ? 'src/entry-connections.tsx' : 'src/entry.tsx'),
        external,
        output: { entryFileNames: 'assets/entry.js', chunkFileNames: 'assets/[name].js', assetFileNames: 'assets/[name].[ext]', format: 'system' },
        preserveEntrySignatures: 'exports-only',
      },
    },
  });
  return readDependencies(await readFile(path.join(directory, 'assets/entry.js'), 'utf8')) ?? [];
}

/**
 * `backend` is whether the plugin has a process: the capabilities are what tells the host to start one (`settings` is the one the SDK serves with no code of the plugin's). `resource` is a capability the plugin's
 * process serves itself: the connections fixture's.
 */
function manifest(id, name, backend, resource = false) {
  const capabilities = backend ? [...(resource ? ['  - resource'] : []), '  - settings', '  - ui'] : ['  - ui'];
  return [`id: ${id}`, 'version: 0.0.1', `name: ${name}`, 'description: Fixture plugin of the new UI seam', 'license: Apache-2.0', 'author:', '  name: Omniview', 'capabilities:', ...capabilities, ''].join('\n');
}

/**
 * Builds the fixture's process (`./process`) to `<directory>/plugin` and answers its path: the Go program of the host's own module, so it needs no network and no module of its own. One build serves every
 * plugin that is given it, in every host a check starts.
 */
export async function buildProcess(directory) {
  await mkdir(directory, { recursive: true });
  const binary = path.join(directory, 'plugin');
  await promisify(execFile)('go', ['build', '-o', binary, './ui-next/plugins/fixture/process'], { cwd: repository, env: { ...process.env, GOWORK: 'off', GOTOOLCHAIN: 'local', GOFLAGS: '' } });
  return binary;
}

/** Builds the connections fixture's process (`./connections-process`) to `<directory>/plugin` and answers its path, as `buildProcess` does for the fixture's own. */
export async function buildConnectionsProcess(directory) {
  await mkdir(directory, { recursive: true });
  const binary = path.join(directory, 'plugin');
  await promisify(execFile)('go', ['build', '-o', binary, './ui-next/plugins/fixture/connections-process'], { cwd: repository, env: { ...process.env, GOWORK: 'off', GOTOOLCHAIN: 'local', GOFLAGS: '' } });
  return binary;
}

/**
 * Builds one plugin into `<root>/<id>/` and answers the dependencies its bundle declares (empty when it has none). With `binary` (the path `buildProcess` answered) the plugin has a process: `bin/plugin`
 * and the capability that makes the host start it.
 */
export async function writePlugin(root, id, binary = undefined) {
  return install(root, id, PLUGINS[id], binary, false);
}

/**
 * Builds the connections plugin (`fixture-f-conn`) into `<root>/fixture-f-conn/`: its bundle, and with `binary` (the path `buildConnectionsProcess` answered) `bin/plugin` and the capabilities `resource`, `settings`
 * and `ui`. Without a binary it is a plugin with no process, which lists no connections. Its `connection-mode` file (next to `bin/`) is the check's to write.
 */
export async function writeConnectionsPlugin(root, binary = undefined) {
  return install(root, CONNECTIONS_ID, CONNECTIONS, binary, true);
}

async function install(root, id, { variant, name, rail }, binary, resource) {
  const directory = path.join(root, id);
  await rm(directory, { recursive: true, force: true });
  await mkdir(path.join(directory, 'assets'), { recursive: true });
  await writeFile(path.join(directory, 'plugin.yaml'), manifest(id, name, binary !== undefined, resource));
  if (binary !== undefined) {
    await mkdir(path.join(directory, 'bin'), { recursive: true });
    await copyFile(binary, path.join(directory, 'bin', 'plugin'));
    await chmod(path.join(directory, 'bin', 'plugin'), 0o755);
  }

  return { id, directory, dependencies: variant === 'missing' ? [] : await buildBundle(id, variant, directory, rail) };
}

export async function writeAll(root) {
  const written = [];
  for (const id of Object.keys(PLUGINS)) {
    written.push(await writePlugin(root, id));
  }

  return written;
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = process.argv[2];
  if (root === undefined) {
    throw new Error('Usage: node ui-next/plugins/fixture/build.mjs <plugins-directory>');
  }

  for (const { id, directory, dependencies } of await writeAll(path.resolve(root))) {
    console.log(`${id}: ${directory} imports [${dependencies.join(', ')}]`);
  }
}
