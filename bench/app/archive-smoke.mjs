#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright';
import { build, preview } from 'vite';
import ts from 'typescript';
import { parse } from 'yaml';
import { requirePluginBundle } from './plugin-bundle.mjs';

// Use a completed production artifact: extracted release assets or an owned source build.
const { values } = parseArgs({ options: { directory: { type: 'string' } } });
assert(values.directory, 'Usage: node bench/app/archive-smoke.mjs --directory PLUGIN_ARTIFACT');
const directory = path.resolve(values.directory);
const assets = path.join(directory, 'assets');
requirePluginBundle(assets);
const metadata = parse(await readFile(path.join(directory, 'plugin.yaml'), 'utf8'));
assert.equal(metadata.id, 'kubernetes');
assert.equal(typeof metadata.version, 'string');

// Rollup externalizes shared imports, so tsc cannot verify the host ABI.
// Read every setter, including lazy routes, without executing plugin bodies.
const imports = [];
let registrations = 0;
for (const file of await readdir(assets)) {
  if (!file.endsWith('.js')) continue;
  const filename = path.join(assets, file);
  const source = await readFile(filename, 'utf8');
  const parsed = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const context = vm.createContext({ System: { register(dependencies, declare) {
    registrations++;
    const registration = declare(() => {}, { meta: { url: `file://${filename}` } });
    dependencies.forEach((dependency, index) => {
      if (dependency.startsWith('.') || dependency.startsWith('/')) return;
      const names = new Set();
      registration.setters?.[index]?.(new Proxy({}, { get(_target, name) {
        if (typeof name === 'string') names.add(name);
        return undefined;
      } }));
      imports.push({ file, dependency, names: [...names] });
    });
  } } });
  for (const statement of parsed.statements) {
    if (!ts.isExpressionStatement(statement) || !ts.isCallExpression(statement.expression)) continue;
    if (statement.expression.expression.getText(parsed) !== 'System.register') continue;
    vm.runInContext(statement.expression.getText(parsed), context, { filename, timeout: 5000 });
  }
}
assert(registrations > 0, 'Archive contains no System.register modules');
const scratch = await mkdtemp(path.join(tmpdir(), 'omniview-archive-smoke-'));
let server;
let browser;
try {
  const metadataFile = path.join(scratch, 'plugin.json');
  await writeFile(metadataFile, JSON.stringify(metadata));
  process.env.OV_K8S_PLUGIN_DIST = assets;
  process.env.OV_K8S_PLUGIN_METADATA = metadataFile;
  process.env.OV_PLUGIN_ARCHIVE_SMOKE = '1';
  process.env.OV_BENCH_PORT = '0';
  const configFile = path.join(import.meta.dirname, 'vite.config.ts');
  const outDir = path.join(scratch, 'dist');
  await build({ configFile, build: { outDir }, logLevel: 'warn' });
  server = await preview({ configFile, build: { outDir }, logLevel: 'warn' });
  browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(`${message.text()} (${message.location().url})`); });
  await page.addInitScript(() => { window.__OV_BENCH__ = { plugins: ['kubernetes'], emptyConnections: true }; });
  await page.goto(server.resolvedUrls.local[0]);
  await page.evaluate(() => window.__ovBench.startup());
  await page.getByText('No clusters connected', { exact: true }).waitFor();
  const missing = await page.evaluate(async records => {
    const failures = [];
    for (const record of records) {
      let module;
      try { module = await System.import(`shared://${record.dependency}`); }
      catch (error) { failures.push(`${record.file}: ${record.dependency}: ${error.message}`); continue; }
      for (const name of record.names) {
        if (!(name in module) || module[name] === undefined) failures.push(`${record.file}: missing ${record.dependency}.${name}`);
      }
    }
    return failures;
  }, imports);
  assert.deepEqual(missing, [], 'Production plugin imports unavailable host exports');
  await page.evaluate(() => { window.location.hash = '#/_plugin/kubernetes/'; });
  const search = page.getByRole('combobox', { name: 'Search clusters', exact: true });
  await search.waitFor();
  await page.getByText('No Clusters Found', { exact: true }).waitFor();
  await search.fill('reg');
  await page.getByRole('option', { name: /^region:/ }).waitFor();
  await search.press('Enter');
  assert.equal(await search.inputValue(), 'region:');
  assert.deepEqual(errors, [], 'Production plugin emitted browser errors');
  console.log(`PASS Kubernetes ${metadata.version}: production home, empty route, search, ${registrations} module registrations, all shared import exports`);
} finally {
  try { await browser?.close(); }
  finally {
    try { await server?.httpServer.closeAllConnections(); await new Promise((resolve, reject) => server ? server.httpServer.close(error => error ? reject(error) : resolve()) : resolve()); }
    finally { await rm(scratch, { recursive: true, force: true }); }
  }
}
