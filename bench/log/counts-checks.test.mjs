// node --test bench/log/counts-checks.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { countsFailures, ownWrites } from './counts-checks.mjs';

const clean = (lines) => ({ lines, rootWrites: [], afterInteractions: { rootCustomWrites: 0 }, afterUnmount: { rootCustomWrites: 0 } });

test('countsFailures: clean counts and agreeing commits fail nothing', () => {
  assert.deepEqual(countsFailures({ results: [clean(60), clean(1000)], commits: { hook: 183, profiler: 183 } }), []);
});

test('countsFailures: a write at the root fails', () => {
  const failures = countsFailures({ results: [clean(60), { ...clean(1000), rootWrites: ['BODY.class'] }], commits: { hook: 5, profiler: 5 } });
  assert.equal(failures.length, 1);
  assert.match(failures[0], /1,000 lines/);
  assert.match(failures[0], /BODY\.class/);
});

// The counts are cumulative since the page loaded, so the snapshot after the unmount holds what the interactions wrote and what the unmount wrote: the view's cleanup is in scope of B9.
test('countsFailures: a custom property written at the root fails, whether the interactions or the unmount wrote it', () => {
  for (const [name, result] of [
    ['interactions', { ...clean(60), afterInteractions: { rootCustomWrites: 2 }, afterUnmount: { rootCustomWrites: 2 } }],
    ['unmount', { ...clean(60), afterUnmount: { rootCustomWrites: 1 } }],
  ]) {
    const failures = countsFailures({ results: [result], commits: { hook: 5, profiler: 5 } });
    assert.equal(failures.length, 1, name);
    assert.match(failures[0], /custom propert/, name);
  }
});

test('countsFailures: a hook count that differs from the Profiler\'s fails', () => {
  const failures = countsFailures({ results: [clean(60)], commits: { hook: 183, profiler: 182 } });
  assert.equal(failures.length, 1);
  assert.match(failures[0], /hook 183.*Profiler 182/);
});

test('ownWrites: the theme provider\'s three attributes on <html> are the product\'s way to flip the root, anything else is a write', () => {
  assert.deepEqual(ownWrites(['HTML.data-ov-theme', 'HTML.data-ov-density', 'HTML.data-ov-text-size']), []);
  assert.deepEqual(ownWrites(['HTML.data-ov-theme', 'BODY.data-ov-theme', 'HTML.style', 'BODY.class']), ['BODY.data-ov-theme', 'HTML.style', 'BODY.class']);
});
