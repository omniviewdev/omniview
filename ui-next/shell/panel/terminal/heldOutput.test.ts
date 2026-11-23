import { describe, expect, it } from 'vitest';
import { createHeldOutput } from './heldOutput';

// The output a session holds for the view that draws it: the base64 text of each chunk exactly as it came (nothing is decoded while nobody reads, so a hidden terminal costs a push). It drops nothing: the
// producer's pacing is the only bound on what waits here (execFeed.test.ts, 'flow control'). It is the "buffer keeps it" of a hidden panel (docs/ui-next/status/T1.md, docs/ui-next/status/T2a.md).

const chunk = (text: string): string => btoa(text);

describe('the output a session holds', () => {
  it('hands back what it was given in order, once, and holds nothing after', () => {
    const held = createHeldOutput();
    held.push(chunk('one'));
    held.push(chunk('two'));
    held.push(chunk('three'));
    const taken = held.take();
    expect(taken.texts).toEqual([chunk('one'), chunk('two'), chunk('three')]);
    expect(taken.bytes).toBe(11);
    expect(held.take()).toEqual({ texts: [], bytes: 0 });
    expect(held.bytes()).toBe(0);
  });

  it('counts the bytes it holds without decoding them', () => {
    const held = createHeldOutput();
    held.push(chunk('abcd'));
    held.push(chunk('ef'));
    expect(held.bytes()).toBe(6);
  });

  it('drops NOTHING, however much it is given: a hundred thousand chunks of a pty read\'s size all come back, in order (the producer\'s pacing is the bound, the hold throws no byte away)', () => {
    const held = createHeldOutput();
    const text = btoa('y'.repeat(20_480));
    for (let index = 0; index < 100_000; index += 1) {
      held.push(text);
    }

    expect(held.bytes()).toBe(100_000 * 20_480);
    const taken = held.take();
    expect(taken.texts).toHaveLength(100_000);
    expect(taken.bytes).toBe(100_000 * 20_480);
    expect(held.bytes()).toBe(0);
  });

  it('can hand back part of what it holds: whole chunks, the oldest first, until a count of bytes is reached, and the rest stays for the next take (the reader that cannot take more now asks for less)', () => {
    const held = createHeldOutput();
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
    const held = createHeldOutput();
    held.push(chunk('aaaaaaaa'));
    expect(held.take(1).texts).toEqual([chunk('aaaaaaaa')]);
    held.push(chunk('bb'));
    expect(held.take(0).texts).toEqual([chunk('bb')]);
  });

  it('reads a long backlog in slices without losing or repeating a chunk, and without holding the chunks it already gave back', () => {
    const held = createHeldOutput();
    for (let index = 0; index < 5_000; index += 1) {
      held.push(chunk(String(index).padStart(4, '0')));
    }

    const seen: string[] = [];
    for (let guard = 0; guard < 10_000 && held.bytes() > 0; guard += 1) {
      seen.push(...held.take(40).texts.map((text) => atob(text)));
      if (guard === 100) {
        held.push(chunk('last'));
      }
    }

    expect(seen).toHaveLength(5_001);
    expect(seen.slice(0, 3)).toEqual(['0000', '0001', '0002']);
    expect(seen.at(-1)).toBe('last');
    expect(new Set(seen).size).toBe(5_001);
  });

  it('can drop what it holds: a session that was closed has no reader to wait for', () => {
    const held = createHeldOutput();
    held.push(chunk('abc'));
    held.clear();
    expect(held.bytes()).toBe(0);
    expect(held.take()).toEqual({ texts: [], bytes: 0 });
  });
});
