import { describe, expect, it } from 'vitest';
import { createHeldOutput } from './heldOutput';

// The output a session holds for the view that draws it: the bytes of each frame exactly as they came (a hidden terminal costs a push and a sum). It drops nothing: the host's flow control is the only bound on what
// waits here (flow.test.ts). It is the "buffer keeps it" of a hidden panel (docs/ui-next/status/T1.md, docs/ui-next/status/T2a.md).

const chunk = (text: string): Uint8Array => new TextEncoder().encode(text);
const texts = (taken: { readonly chunks: readonly Uint8Array[] }): string[] => taken.chunks.map((one) => new TextDecoder().decode(one));

describe('the output a session holds', () => {
  it('hands back what it was given in order, once, and holds nothing after', () => {
    const held = createHeldOutput();
    held.push(chunk('one'));
    held.push(chunk('two'));
    held.push(chunk('three'));
    const taken = held.take();
    expect(texts(taken)).toEqual(['one', 'two', 'three']);
    expect(taken.bytes).toBe(11);
    expect(held.take()).toEqual({ chunks: [], bytes: 0 });
    expect(held.bytes()).toBe(0);
  });

  it('counts the bytes it holds', () => {
    const held = createHeldOutput();
    held.push(chunk('abcd'));
    held.push(chunk('ef'));
    expect(held.bytes()).toBe(6);
  });

  it('drops NOTHING, however much it is given: a hundred thousand chunks of a pty read\'s size all come back, in order (the producer\'s pacing is the bound, the hold throws no byte away)', () => {
    const held = createHeldOutput();
    const text = chunk('y'.repeat(20_480));
    for (let index = 0; index < 100_000; index += 1) {
      held.push(text);
    }

    expect(held.bytes()).toBe(100_000 * 20_480);
    const taken = held.take();
    expect(taken.chunks).toHaveLength(100_000);
    expect(taken.bytes).toBe(100_000 * 20_480);
    expect(held.bytes()).toBe(0);
  });

  it('can hand back part of what it holds: whole chunks, the oldest first, until a count of bytes is reached, and the rest stays for the next take (the reader that cannot take more now asks for less)', () => {
    const held = createHeldOutput();
    held.push(chunk('aaaa'));
    held.push(chunk('bbbb'));
    held.push(chunk('cccc'));
    const first = held.take(5);
    expect(texts(first)).toEqual(['aaaa', 'bbbb']);
    expect(first.bytes).toBe(8);
    expect(held.bytes()).toBe(4);
    const second = held.take(5);
    expect(texts(second)).toEqual(['cccc']);
    expect(held.bytes()).toBe(0);
  });

  it('always hands back at least one chunk when it holds one, however little is asked for: a reader that asks for less than a chunk must still make progress', () => {
    const held = createHeldOutput();
    held.push(chunk('aaaaaaaa'));
    expect(texts(held.take(1))).toEqual(['aaaaaaaa']);
    held.push(chunk('bb'));
    expect(texts(held.take(0))).toEqual(['bb']);
  });

  it('reads a long backlog in slices without losing or repeating a chunk, and without holding the chunks it already gave back', () => {
    const held = createHeldOutput();
    for (let index = 0; index < 5_000; index += 1) {
      held.push(chunk(String(index).padStart(4, '0')));
    }

    const seen: string[] = [];
    for (let guard = 0; guard < 10_000 && held.bytes() > 0; guard += 1) {
      seen.push(...texts(held.take(40)));
      if (guard === 100) {
        held.push(chunk('last'));
      }
    }

    expect(seen).toHaveLength(5_001);
    expect(seen.slice(0, 3)).toEqual(['0000', '0001', '0002']);
    expect(seen.at(-1)).toBe('last');
    expect(new Set(seen).size).toBe(5_001);
  });

  it('hands back the very arrays it was given: the bytes are the caller\'s to keep, and nothing is copied', () => {
    const held = createHeldOutput();
    const one = chunk('one');
    held.push(one);
    expect(held.take().chunks[0]).toBe(one);
  });

  it('can drop what it holds: a session that was closed has no reader to wait for', () => {
    const held = createHeldOutput();
    held.push(chunk('abc'));
    held.clear();
    expect(held.bytes()).toBe(0);
    expect(held.take()).toEqual({ chunks: [], bytes: 0 });
  });
});
