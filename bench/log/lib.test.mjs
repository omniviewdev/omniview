// node --test bench/log/lib.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { calibrate, pointerTarget, requireWorkload } from './lib.mjs';

/** A page whose list scrolled `delivered` px in answer to the calibration burst; the wheel events go nowhere. */
const fakePage = (delivered) => ({
  evaluate: async (fn) => (String(fn).includes('scrollTop()') ? delivered : undefined),
  mouse: { wheel: async () => undefined },
});

test('calibrate: a burst that scrolled nothing is rejected, not scale 1', async () => {
  await assert.rejects(calibrate(fakePage(0)), /no scroll pixels/);
});

test('calibrate: a delivered burst gives the scale that makes the requested pixels arrive', async () => {
  const result = await calibrate(fakePage(100));
  assert.equal(result.deliveredPx, 100);
  assert.equal(result.scale, Math.round((result.requestedPx / 100) * 1000) / 1000);
});

test('pointerTarget: the default stage keeps the pointer where the committed runs put it', () => {
  // kit: the list is 1390 x 529 at (50, 64); control: the same list at (50, 25)
  assert.deepEqual(pointerTarget({ left: 50, top: 64, right: 1440, bottom: 593 }), { x: 750, y: 214 });
  assert.deepEqual(pointerTarget({ left: 50, top: 25, right: 1440, bottom: 554 }), { x: 750, y: 214 });
});

test('pointerTarget: a short list gets the pointer inside it', () => {
  // --height 180: the stage ends at y=205, the kit's list is 113 px tall from y=64
  const target = pointerTarget({ left: 50, top: 64, right: 1440, bottom: 177 });
  assert.ok(target.y > 64 && target.y < 177, `y ${target.y}`);
  assert.ok(target.x > 50 && target.x < 1440, `x ${target.x}`);
});

test('requireWorkload: a stream that stopped short of the requested lines is an error', () => {
  assert.throws(() => requireWorkload(400_000, 1_000_000, 120), /400,000 of the 1,000,000 lines.*120 s/);
  assert.doesNotThrow(() => requireWorkload(1_000_000, 1_000_000, 20));
  assert.doesNotThrow(() => requireWorkload(1_050_000, 1_000_000, 21));
});

test('requireWorkload: lines the feed dropped were counted as streamed but never went through the view, so the workload is not the one requested', () => {
  assert.throws(() => requireWorkload(1_000_000, 1_000_000, 20, 500_000), /dropped 500,000/);
  assert.doesNotThrow(() => requireWorkload(1_000_000, 1_000_000, 20, 0));
});
