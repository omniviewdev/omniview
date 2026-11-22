import { describe, expect, it } from 'vitest';
import { createHeldOutput } from './heldOutput';

// The output a session holds for the view that draws it: the base64 text of each chunk exactly as it came (nothing is decoded while nobody reads, so a hidden terminal costs a push), bounded in bytes,
// the oldest dropped and counted. It is the "buffer keeps it" of a hidden panel (docs/ui-next/status/T1.md).

const chunk = (text: string): string => btoa(text);

describe('the output a session holds', () => {
  it('hands back what it was given in order, once, and holds nothing after', () => {
    const held = createHeldOutput(1_000);
    held.push(chunk('one'));
    held.push(chunk('two'));
    held.push(chunk('three'));
    const taken = held.take();
    expect(taken.texts).toEqual([chunk('one'), chunk('two'), chunk('three')]);
    expect(taken.bytes).toBe(11);
    expect(taken.dropped).toBe(0);
    expect(held.take()).toEqual({ texts: [], bytes: 0, dropped: 0 });
    expect(held.bytes()).toBe(0);
  });

  it('counts the bytes it holds without decoding them', () => {
    const held = createHeldOutput(1_000);
    held.push(chunk('abcd'));
    held.push(chunk('ef'));
    expect(held.bytes()).toBe(6);
  });

  it('drops the OLDEST chunks past its bound, and says how many bytes went', () => {
    const held = createHeldOutput(10);
    held.push(chunk('aaaa'));
    held.push(chunk('bbbb'));
    held.push(chunk('cccc'));
    expect(held.bytes()).toBe(8);
    const taken = held.take();
    expect(taken.texts).toEqual([chunk('bbbb'), chunk('cccc')]);
    expect(taken.dropped).toBe(4);
  });

  it('adds up the drops of many pushes and reports them with the next take only', () => {
    const held = createHeldOutput(8);
    for (let index = 0; index < 10; index += 1) {
      held.push(chunk('xxxx'));
    }

    const first = held.take();
    expect(first.texts).toHaveLength(2);
    expect(first.dropped).toBe(32);
    held.push(chunk('yyyy'));
    expect(held.take().dropped).toBe(0);
  });

  it('keeps the newest chunk even when it alone is over the bound: a bound that dropped the last thing the process wrote would leave the screen blank', () => {
    const held = createHeldOutput(4);
    held.push(chunk('aaaaaaaa'));
    expect(held.take()).toEqual({ texts: [chunk('aaaaaaaa')], bytes: 8, dropped: 0 });
    held.push(chunk('aa'));
    held.push(chunk('bbbbbbbb'));
    expect(held.take().texts).toEqual([chunk('bbbbbbbb')]);
  });

  it('holds a hundred thousand chunks of a pty read\'s size at its bound with no growth', () => {
    const held = createHeldOutput(4 << 20);
    const text = btoa('y'.repeat(20_480));
    for (let index = 0; index < 100_000; index += 1) {
      held.push(text);
    }

    expect(held.bytes()).toBeLessThanOrEqual(4 << 20);
    expect(held.bytes()).toBeGreaterThan((4 << 20) - 20_480);
    const taken = held.take();
    expect(taken.texts.length).toBe(Math.floor((4 << 20) / 20_480));
    expect(taken.dropped + taken.bytes).toBe(100_000 * 20_480);
  });

  it('can hand back part of what it holds: whole chunks, the oldest first, until a count of bytes is reached, and the rest stays for the next take (the reader that cannot take more now asks for less)', () => {
    const held = createHeldOutput(1_000);
    held.push(chunk('aaaa'));
    held.push(chunk('bbbb'));
    held.push(chunk('cccc'));
    const first = held.take(5);
    expect(first.texts).toEqual([chunk('aaaa'), chunk('bbbb')]);
    expect(first.bytes).toBe(8);
    expect(held.bytes()).toBe(4);
    const second = held.take(5);
    expect(second.texts).toEqual([chunk('cccc')]);
    expect(held.bytes()).toBe(0);
  });

  it('always hands back at least one chunk when it holds one, however little is asked for: a reader that asks for less than a chunk must still make progress', () => {
    const held = createHeldOutput(1_000);
    held.push(chunk('aaaaaaaa'));
    expect(held.take(1).texts).toEqual([chunk('aaaaaaaa')]);
    held.push(chunk('bb'));
    expect(held.take(0).texts).toEqual([chunk('bb')]);
  });

  it('reports the bytes it dropped with the first take after the drop, even a partial one, and once', () => {
    const held = createHeldOutput(8);
    for (let index = 0; index < 4; index += 1) {
      held.push(chunk('xxxx'));
    }

    const first = held.take(4);
    expect(first.texts).toHaveLength(1);
    expect(first.dropped).toBe(8);
    expect(held.take(4).dropped).toBe(0);
  });

  it('can drop what it holds: a session that ended has no reader to wait for', () => {
    const held = createHeldOutput(100);
    held.push(chunk('abc'));
    held.clear();
    expect(held.bytes()).toBe(0);
    expect(held.take()).toEqual({ texts: [], bytes: 0, dropped: 0 });
  });
});
