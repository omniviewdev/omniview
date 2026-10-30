import assert from 'node:assert/strict';
import test from 'node:test';
import { validateShimExports } from './check-shim-exports';
import { generateShim } from './shared-exports';

test('facades preserve every named and default singleton value', () => {
  const namespace = { use: () => {}, version: '19', default: { singleton: true } };
  const names = Object.keys(namespace);
  validateShimExports('react', names, generateShim('react', names), namespace);
});

test('facades preserve string-named exports without fabricating a default', () => {
  validateShimExports('package/subpath', ['name-with-dash'], generateShim('package/subpath', ['name-with-dash']));
});

test('parity rejects removed and missing exports', () => {
  assert.throws(() => validateShimExports('react-dom', ['createPortal'],
    generateShim('react-dom', ['createPortal', 'render'])), /export names differ/);
  assert.throws(() => validateShimExports('react-router/dom', ['RouterProvider'],
    generateShim('react-router/dom', [])), /export names differ/);
});

test('parity rejects incorrect singleton values even when names match', () => {
  assert.throws(() => validateShimExports('react', ['use'],
    'export const use = () => {};'), /incorrect singleton binding use/);
});

test('parity rejects invented default exports', () => {
  assert.throws(() => validateShimExports('react-router', ['useNavigate'],
    generateShim('react-router', ['useNavigate', 'default'])), /export names differ/);
});

test('parity rejects wrong default singleton values', () => {
  assert.throws(() => validateShimExports('package', ['default'],
    'export default {};', { default: {} }), /incorrect singleton binding default/);
});

test('style facades expose no fabricated JavaScript exports', () => {
  validateShimExports('package/styles.css', [], generateShim('package/styles.css', []));
});
