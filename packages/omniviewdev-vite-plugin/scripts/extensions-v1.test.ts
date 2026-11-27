import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { build } from 'vite';
import ts from 'typescript';
import { omniviewExtensionsV1 } from '../src/index';

const sdk = '@omniviewdev/runtime/ui/extensions/v1';
const points = '@fixture/owner-points';
const version = '1.4.0-rc.1+packed';
const require = createRequire(import.meta.url);
const base = mkdtempSync(path.join(tmpdir(), 'omniview packed extensions '));
const modules = path.join(base, 'node_modules');
const read = (file: string) => readFileSync(file, 'utf8');
const write = (file: string, text: string) => { mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, text); };
const json = (file: string, value: unknown) => write(file, JSON.stringify(value));

/** Install the actual npm tarball, without network, install scripts, workspace links or tsconfig path aliases. */
function pack(root: string, name: string): void {
  const packed = JSON.parse(execFileSync('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', base], { cwd: root, encoding: 'utf8' }));
  const target = path.join(modules, name);
  mkdirSync(target, { recursive: true });
  execFileSync('tar', ['-xzf', path.join(base, packed[0].filename), '-C', target, '--strip-components=1']);
}

const declarations = `import { defineRead, defineProtocol, definePoint, utilizationV1 } from '${sdk}';
const fields = { kind: 'string', manager: 'string' } as const;
const workload = { fields, optional: ['manager'] } as const;
export const ctx = definePoint('owner', 'actions', defineProtocol('owner/actions@1', { kind: 'menu', ...workload }), {
  label: 'Context actions', placement: 'context-menu' });
export const side = definePoint('owner', 'sidebar', defineProtocol('owner/sidebar@1', { kind: 'view', fields: {} }), {
  label: 'Sidebar tools', placement: 'sidebar' });
const related = defineRead('owner/edges@1', {row: {name: 'string'}});
export const tab = definePoint('owner', 'tabs', defineProtocol('owner/details@1', {kind: 'view', ...workload, read: related}), {
  label: 'Detail tabs', placement: 'detail-tab' });
export const cpu = definePoint('owner', 'cpu', utilizationV1, {label: 'CPU', placement: 'overview-section', warmOnPage: 'overview'});`;

before(() => {
  const runtime = path.resolve(import.meta.dirname, '../../omniviewdev-runtime');
  pack(runtime, '@omniviewdev/runtime');
  // React is an existing external; the clean projects use its real declarations, not a fake JSX environment.
  for (const name of ['react', '@types/react']) {
    const target = path.join(modules, name);
    mkdirSync(path.dirname(target), { recursive: true });
    symlinkSync(path.dirname(require.resolve(`${name}/package.json`)), target, 'dir');
  }
  const publisher = path.join(base, 'contract-publisher');
  json(path.join(publisher, 'package.json'), { name: points, version, type: 'module', files: ['dist'],
    peerDependencies: { '@omniviewdev/runtime': JSON.parse(read(path.join(runtime, 'package.json'))).version },
    exports: { '.': { types: './dist/index.d.ts', import: './dist/index.js' } } });
  write(path.join(publisher, 'src/points.ts'), declarations);
  write(path.join(publisher, 'src/index.ts'), `export { ctx as terminal, side as sidebar, tab as details, cpu } from './points.js';`);
  const program = ts.createProgram([path.join(publisher, 'src/index.ts')], { module: ts.ModuleKind.ESNext,
    rootDir: path.join(publisher, 'src'),
    moduleResolution: ts.ModuleResolutionKind.Bundler, target: ts.ScriptTarget.ES2022, declaration: true,
    strict: true, exactOptionalPropertyTypes: true, skipLibCheck: true, noEmitOnError: true, outDir: path.join(publisher, 'dist') });
  const diagnostics = ts.getPreEmitDiagnostics(program);
  assert.deepEqual(diagnostics.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')), []);
  assert.equal(program.emit().emitSkipped, false);
  pack(publisher, points);
  rmSync(publisher, { recursive: true });
});
after(() => rmSync(base, { recursive: true, force: true }));

const peerDescriptor = `import { definePlugin, defineOffer, defineMenuOffer, defineViewOffer } from '${sdk}';
import { cpu, details, terminal as menu, sidebar } from '${points}';
const when = [{field:'kind', equals:'Pod'}, {field:'manager', equals:'tools'}] as const;
const opts = {requests:['kind','manager'], targets:[{point:menu, when}]} as const;
const note = defineMenuOffer(menu.protocol, {...opts, label:'Describe', action:{kind:'info'}});
const show = defineMenuOffer(menu.protocol, {...opts, label:'Open', action:{kind:'openView',point:sidebar,offer:'tools-view'}});
const fact = defineOffer(cpu.protocol, {label:'Used', requests:['used','capacity'], targets:[cpu]});
const tools = defineViewOffer(sidebar.protocol, {label:'Tools', requests:[], targets:[sidebar]});
const detail = defineViewOffer(details.protocol, {label:'Edges', requests:['kind'], targets:[details], requestRead:true});
export default definePlugin({id:'peer', offers:{note,show,fact,'tools-view':tools,detail}});`;
const features = `import type plugin from './extension.js';
import type {OfferInput, OfferResult} from '${sdk}';
import { format } from './private.js';
Reflect.set(globalThis, '__packagerEvaluated', true);
type Offers = typeof plugin.offers;
export function note(input: OfferInput<Offers['note']>): OfferResult<Offers['note']> { return {text:input.manager ?? 'N/A'}; }
export function fact(input: OfferInput<Offers['fact']>, signal: AbortSignal) { return {label:'Used',value:format(input.used)}; }`;
const views = `import type {ViewProps} from '${sdk}';
import type plugin from './extension.js';
import { useState } from 'react';
type Offers = typeof plugin.offers;
function Tools(_props: ViewProps<Offers['tools-view']>) { const [title] = useState('Tools'); return <h2>{title}</h2>; }
function Detail({input,related}: ViewProps<Offers['detail']>) { return <p>{input.kind} {related.state}</p>; }
export { Tools as 'tools-view', Detail as detail };`;
const owner = `import { definePlugin } from '${sdk}'; import { cpu, details as detail, terminal, sidebar } from '${points}';
export default definePlugin({id:'owner', points:[cpu, detail, terminal, sidebar]});`;

function project(installed: 'owner' | 'peer'): string {
  const root = path.join(mkdtempSync(path.join(base, 'installed ')), 'ui');
  write(path.join(root, '../plugin.yaml'), `id: ${installed}\nname: Fixture\n`);
  json(path.join(root, 'package.json'), { private: true, type: 'module', dependencies: {
    [points]: version, '@omniviewdev/runtime': JSON.parse(read(path.join(modules, '@omniviewdev/runtime/package.json'))).version,
  } });
  json(path.join(root, 'tsconfig.json'), { compilerOptions: { strict: true, exactOptionalPropertyTypes: true, noEmit: true,
    skipLibCheck: true, target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', jsx: 'react-jsx', types: [] }, include: ['src'] });
  write(path.join(root, 'src/extension.ts'), installed === 'owner' ? owner : peerDescriptor);
  if (installed === 'peer') {
    write(path.join(root, 'src/features.ts'), features);
    write(path.join(root, 'src/private.ts'), `export function format(value: number | undefined) { return String(value ?? 'N/A'); }`);
    write(path.join(root, 'src/views.tsx'), views);
  }
  return root;
}

function compile(root: string) {
  return build({ root, configFile: false, publicDir: false, logLevel: 'silent', plugins: [omniviewExtensionsV1()],
    build: { emptyOutDir: false, outDir: 'package-output', minify: false, reportCompressedSize: false, rollupOptions: {
      input: path.join(root, 'src/entry.ts'), preserveEntrySignatures: 'exports-only', output: { format: 'system', entryFileNames: 'assets/entry.js' } } } });
}
const assets = (root: string) => path.join(root, 'package-output/assets');
const files = (root: string) => readdirSync(assets(root)).sort();

function deps(code: string): string[] {
  const match = /^System\.register\((\[[^\]]*\]),\s*\(?function\b/.exec(code);
  assert.ok(match, 'expected anonymous System.register');
  return JSON.parse(match[1].replaceAll("'", '"'));
}

test('catalogue locators identify the actual packed root re-export; pages keep their normal entry', async () => {
  const root = project('owner');
  write(path.join(root, 'src/entry.ts'), `export const contributionV1 = { schemaVersion: 1 };`);
  await compile(root);
  assert.deepEqual(files(root), ['entry.js', 'extensions.v1.json']);
  const { points: records, offers, bindings } = JSON.parse(read(path.join(assets(root), 'extensions.v1.json')));
  assert.deepEqual(records.map((r: { contract: unknown }) => r.contract), ['cpu', 'details', 'terminal', 'sidebar'].map(name => ({ package: points, version, export: name })));
  assert.deepEqual(records[0], { id:'cpu', label:'CPU', placement:'overview-section', warmOnPage:'overview', kind:'section', protocol:'visuals/utilization@1', contract:records[0].contract });
  assert.deepEqual(records[1].read, { id:'owner/edges@1', row:{name:'string'} });
  assert.deepEqual(offers, []); assert.deepEqual(bindings, []);
});

test('route-less peer ships distinct anonymous modules, pinned declarations, and explicit conditional edges', async () => {
  const root = project('peer');
  await compile(root);
  assert.deepEqual(files(root), ['extensions.js','extensions.v1.json','views.js']);
  assert.equal(Reflect.has(globalThis, '__packagerEvaluated'), false);
  const data = JSON.parse(read(path.join(assets(root), 'extensions.v1.json')));
  assert.deepEqual(Object.keys(data), ['schemaVersion','id','points','offers','bindings']);
  assert.deepEqual(data.points, []);
  assert.equal(data.offers.length, 5);
  assert.deepEqual(data.offers[1].action, {kind:'openView',point:'owner/sidebar',offer:'tools-view'});
  assert.deepEqual(data.bindings[0], {offer:'note',target:'owner/actions',when:[{field:'kind',equals:'Pod'},{field:'manager',equals:'tools'}]});
  assert.deepEqual(deps(read(path.join(assets(root), 'extensions.js'))), []);
  assert.deepEqual(deps(read(path.join(assets(root), 'views.js'))).sort(), ['react','react/jsx-runtime']);
  assert.ok(read(path.join(assets(root), 'views.js')).includes('tools-view'));
});

test('failed role build leaves old assets intact; successful role and page removal retire stale files', async () => {
  const root = project('peer');
  const entry = path.join(root, 'src/entry.ts');
  write(entry, `export const contributionV1 = {schemaVersion:1};`);
  await compile(root);
  const before = files(root).map(name => [name, read(path.join(assets(root), name))]);
  write(path.join(root, 'src/features.ts'), features + '\nexport const extra = () => 1;');
  await assert.rejects(compile(root), /emitted named exports/);
  assert.deepEqual(files(root).map(name => [name, read(path.join(assets(root), name))]), before);
  rmSync(entry);
  for (const name of ['views.tsx','features.ts']) rmSync(path.join(root, 'src', name));
  write(path.join(root, 'src/extension.ts'), `import {definePlugin} from '${sdk}';export default definePlugin({id:'peer'});`);
  await compile(root);
  assert.deepEqual(files(root), ['extensions.v1.json']);
  rmSync(path.join(root, 'src/extension.ts'));
  rmSync(path.join(root, 'tsconfig.json')); // Pages-only builds acquire no extension compiler requirements.
  write(entry, `export const contributionV1 = {schemaVersion:1};`);
  write(path.join(assets(root), 'keep.txt'), 'unrelated');
  await compile(root);
  assert.deepEqual(files(root), ['entry.js', 'keep.txt']);
});

test('static metadata rejects deep imports, invented references, unchecked syntax, ranges and wrong owner', async () => {
  const root = project('owner');
  const descriptor = path.join(root, 'src/extension.ts');
  for (const [invalid, reason] of [
    [owner.replace(`'${points}'`, `'${points}/dist/points.js'`), /public package root/],
    [owner.replace('points:[cpu,', 'points:[{...cpu},'), /actual named export/],
    [owner.replace('points:[cpu,', 'points:[(cpu as typeof cpu),'), /type assertion/],
    [owner.replace('points:[cpu,', 'points:[(() => cpu)(),'), /dynamic expression/],
    [owner + '\nconst ignored = (() => { Reflect.set(globalThis, "badDescriptor", true); return 1; })();', /dynamic expression/],
    [owner.replace("id:'owner'", "get id() { throw new Error('getter executed'); }"), /accessors/],
    [owner.replace("id:'owner'", "id:'other'"), /match plugin.yaml/],
  ] as const) {
    write(descriptor, invalid); await assert.rejects(compile(root), reason);
    assert.equal(Reflect.has(globalThis, 'badDescriptor'), false);
  }
  write(descriptor, owner);
  json(path.join(root, 'package.json'), {type:'module', dependencies:{[points]:'^1.4.0'}});
  await assert.rejects(compile(root), /pinned to the installed exact version/);
  assert.equal(existsSync(path.join(assets(root), 'extensions.v1.json')), false);
});

test('wrong role, missing or surplus executable, type-only export and narrower host props fail before delivery', async () => {
  const root = project('peer');
  const body = path.join(root, 'src/views.tsx');
  for (const [change, reason] of [
    [views.replace("function Tools(_props: ViewProps<Offers['tools-view']>)", 'function Tools(_props: {input: {required: string}})'), /TS2344/],
    [views.replace('function Detail(', 'async function Detail('), /TS2344/],
    [views.replace("export { Tools as 'tools-view', Detail as detail };", "export { Tools as 'tools-view' }; export type detail = typeof Detail;"), /TS/],
    [views + '\nexport { Tools as note };', /emitted named exports/],
  ] as const) { write(body, change); await assert.rejects(compile(root), reason); }
  write(body, views);
  write(path.join(root, 'src/features.ts'), features.replace("input: OfferInput<Offers['note']>", 'input: {manager:string}'));
  await assert.rejects(compile(root), /TS2344/);
  rmSync(path.join(root, 'src/features.ts'));
  await assert.rejects(compile(root), /expected src\/features.ts/);
});

test('closed module graphs reject forbidden transitive imports, loaders, non-code assets and oversized modules', async () => {
  const root = project('peer');
  const featureFile = path.join(root, 'src/features.ts'), privateFile = path.join(root, 'src/private.ts'), original = read(privateFile);
  for (const [extra, reason] of [
    [`\nimport {createElement} from 'react'; void createElement;`, /allowed public package/],
    [`\nexport const more = () => import('./features.js');`, /dynamic imports/],
    [`\nconst asset = new URL('./more.css', import.meta.url); void asset;`, /module loaders/],
  ] as const) { write(privateFile, original + extra); await assert.rejects(compile(root), reason); }
  write(privateFile, original);
  const body = path.join(root, 'src/views.tsx');
  write(body, views + `\nimport {utilizationV1} from '${sdk}'; void utilizationV1;`);
  await assert.rejects(compile(root), /allowed public package/);
  write(path.join(root, 'src/global.d.ts'), "declare module '*.css';");
  write(path.join(root, 'src/style.css'), 'p {color:red}');
  write(body, views + "\nimport './style.css';");
  await assert.rejects(compile(root), /local module|local code module/);
  write(body, views);
  write(featureFile, features.replace("label:'Used'", `label:'${'x'.repeat(1024 * 1024)}'`));
  await assert.rejects(compile(root), /exceeds 1 MiB/);
  write(featureFile, features);
  write(body, views + "\nimport 'react/jsx-dev-runtime';");
  await assert.rejects(compile(root), /allowed public package/);
});

test('switching between scalar-only and view-only peers removes obsolete role assets', async () => {
  const root = project('peer'), src = path.join(root, 'src');
  rmSync(path.join(src, 'views.tsx'));
  write(path.join(src, 'extension.ts'), `import {definePlugin, defineOffer} from '${sdk}';import {cpu} from '${points}';
    export default definePlugin({id:'peer', offers:{fact:defineOffer(cpu.protocol,{label:'Fact',requests:[],targets:[cpu]})}});`);
  write(path.join(src, 'features.ts'), `export const fact = () => ({label:'Fact', value:'0'});`);
  await compile(root);
  assert.deepEqual(files(root), ['extensions.js', 'extensions.v1.json']);
  rmSync(path.join(src, 'features.ts'));
  write(path.join(src, 'extension.ts'), `import {definePlugin, defineMenuOffer, defineViewOffer} from '${sdk}';import {sidebar, terminal} from '${points}';
    const panel = defineViewOffer(sidebar.protocol,{label:'Panel',requests:[],targets:[sidebar]});
    const open = defineMenuOffer(terminal.protocol,{label:'Open',requests:[],targets:[terminal],action:{kind:'openView',point:sidebar,offer:'panel'}});
    export default definePlugin({id:'peer', offers:{panel,open}});`);
  write(path.join(src, 'views.tsx'), `export function panel() { return null; }`);
  await compile(root);
  assert.deepEqual(files(root), ['extensions.v1.json', 'views.js']);
});

test('bindings use the complete external point and the canonical same-contributor destination check', async () => {
  const root = project('peer'), file = path.join(root, 'src/extension.ts');
  for (const [change, reason] of [
    [peerDescriptor.replace('targets:[cpu]', 'targets:[sidebar]'), /target.protocol/],
    [peerDescriptor.replace('targets:[sidebar]', "targets:[{point:sidebar,when:[{field:'x',equals:0}]}]"), /target.when/],
    [peerDescriptor.replace("point:sidebar,offer:'tools-view'", "point:details,offer:'tools-view'"), /action|binding|destination/i],
  ] as const) { write(file, change); await assert.rejects(compile(root), reason); }
});

test('installed JS and types must agree; unchecked declarations and project path aliases cannot supply a point locator', async () => {
  const root = project('owner');
  // Private copy of the packed installation, so no negative case can mutate another consumer's package.
  const pkg = path.join(root, 'node_modules', points);
  cpSync(path.join(modules, points), pkg, { recursive: true });
  const dts = path.join(pkg, 'dist/points.d.ts'), original = read(dts);
  write(dts, original.replaceAll('"Context actions"', '"Fabricated label"'));
  await assert.rejects(compile(root), /exact literal declaration/);
  write(dts, original.replaceAll('"Context actions"', 'string'));
  await assert.rejects(compile(root), /exact literal declaration/);
  write(dts, original);
  const js = path.join(pkg, 'dist/index.js'), exports = read(js);
  write(js, exports.replace('ctx as terminal', 'ctx as notTerminal'));
  await assert.rejects(compile(root), /missing named JavaScript export/);
  write(js, exports + '\nconst ignored = (() => { Reflect.set(globalThis, "badContract", true); })();');
  await assert.rejects(compile(root), /dynamic expression/);
  assert.equal(Reflect.has(globalThis, 'badContract'), false);
  write(js, exports);
  const cfg = path.join(root, 'tsconfig.json'), config = JSON.parse(read(cfg));
  cpSync(dts, path.join(root, 'src/alias.d.ts'));
  config.compilerOptions.paths = { [points]: ['./src/alias.d.ts'] };
  json(cfg, config);
  await assert.rejects(compile(root), /not a source alias/);
  delete config.compilerOptions.paths; config.compilerOptions.strictFunctionTypes = false; json(cfg, config);
  await assert.rejects(compile(root), /require strict/);
});
