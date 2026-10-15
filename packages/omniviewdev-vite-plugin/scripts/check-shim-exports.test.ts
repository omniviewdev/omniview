import assert from 'node:assert/strict';
import test from 'node:test';

import { findMissingShimExports } from './check-shim-exports';

test('finds runtime exports that the dev shim cannot import', () => {
  const runtimeSource = `
    const a = () => {};
    const b = () => {};
    export { a as relationshipLabel, b as useRelatedResources };
  `;
  const shimSource = `
    const mod = window.__OMNIVIEW_SHARED__['@omniviewdev/runtime'];
    export const relationshipLabel = mod.relationshipLabel;
  `;

  assert.deepEqual(findMissingShimExports(runtimeSource, shimSource), ['useRelatedResources']);
});
