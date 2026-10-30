import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { resolveConfig } from 'vite';
import { transform as lowerJSX } from 'esbuild';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const config = await resolveConfig({
  configFile: path.join(root, 'vite.config.ts'),
  configLoader: 'runner',
  root,
  server: { hmr: false },
}, 'serve', 'test');
const compiler = config.plugins.find((plugin) => plugin.name === 'vite:react-babel');
assert.ok(compiler?.transform, 'load the actual configured React transform');

const component = `
export function SourcePanel({ label }) {
  return <span>{label}</span>;
}
`;
const builtComponent = `
import { c as _c } from 'react/compiler-runtime';
import { jsx as _jsx } from 'react/jsx-runtime';
export function BuiltPanel({ label }) {
  const $ = _c(2);
  let result;
  if ($[0] !== label) {
    result = _jsx('span', { children: label });
    $[0] = label;
    $[1] = result;
  } else {
    result = $[1];
  }
  return result;
}
`;

function transform(code, filename) {
  return compiler.transform.handler.call({
    error(error) { throw new Error(error.message, { cause: error.cause }); },
  }, code, filename, { ssr: false });
}

for (const filename of [
  'ui/components/SourcePanel.tsx',
  'packages/omniviewdev-runtime/src/components/SourcePanel.tsx',
  'bench/render/harness/SourcePanel.tsx',
  'bench/app/page/SourcePanel.tsx',
  'plugins/kubernetes/ui/src/components/SourcePanel.tsx',
]) {
  test(`actual compiled source renders its supplied label: ${filename}`, async () => {
    const result = await transform(component, path.join(root, filename));
    assert.ok(result, 'source reaches the compiler');
    const executable = await lowerJSX(result.code, { loader: 'tsx', jsx: 'automatic', format: 'cjs' });
    const module = { exports: {} };
    // Resolve both compiler-runtime and jsx-runtime through the same installed
    // React instance used by createElement and the real server renderer.
    new Function('module', 'exports', 'require', executable.code)(module, module.exports, require);
    assert.equal(
      renderToStaticMarkup(createElement(module.exports.SourcePanel, { label: 'Source & runtime' })),
      '<span>Source &amp; runtime</span>',
    );
    assert.equal(
      renderToStaticMarkup(createElement(module.exports.SourcePanel, { label: 'Different <label>' })),
      '<span>Different &lt;label&gt;</span>',
    );
  });
}

for (const filename of [
  path.join(path.dirname(root), 'ui/packages/base-ui/dist/index.js'),
  path.join(root, 'packages/omniviewdev-providers/dist/index.js'),
  path.join(root, 'dist/assets/index.js'),
  path.join(root, 'ui/node_modules/third-party/index.js'),
  path.join(root, 'node_modules/.vite/deps/@omniviewdev_base-ui.js'),
]) {
  test(`actual Babel transform leaves built output untouched: ${path.relative(root, filename)}`, async () => {
    assert.equal(await transform(builtComponent, filename), undefined);
  });
}

test('actual compiler source admission does not match a sibling root prefix', async () => {
  assert.equal(await transform(component, path.join(`${root}-other`, 'ui/SourcePanel.tsx')), undefined);
});
