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

// THE MARKS IN THE OUTPUT (issue #694 step 5). A reader creates a marker at the place a mark stands, which is a place in the emulator's parse: so what is taken is cut where a mark stands, and the mark goes with the bytes that
// end at it. A mark that arrives when its bytes were taken already goes with the next take, which then holds no bytes.

const prompt = (end: number, extra: object = {}) => ({ kind: 'prompt-start' as const, at: end - 4, end, trust: 'unverified' as const, ...extra });
const placed = (taken: { readonly marks?: readonly { readonly mark: { readonly end: number }; readonly at: number }[] | undefined }): Array<readonly [number, number]> => (taken.marks ?? []).map((one) => [one.mark.end, one.at]);

describe('the marks in the output a session holds', () => {
  it('hands a mark over with the bytes that end at it, and cuts what it hands over there: the bytes after the mark wait for the next take', () => {
    const held = createHeldOutput();
    held.push(chunk('abcd'));
    held.mark(prompt(4), 0);
    held.push(chunk('efgh'));
    const first = held.take();
    expect(texts(first)).toEqual(['abcd']);
    expect(first.bytes).toBe(4);
    expect(placed(first)).toEqual([[4, 4]]);
    const second = held.take();
    expect(texts(second)).toEqual(['efgh']);
    expect(second.marks, 'a mark is handed over once').toBeUndefined();
  });

  it('cuts INSIDE a chunk when the mark stands inside it (a host that did not cut where the protocol says), and loses no byte', () => {
    const held = createHeldOutput();
    held.push(chunk('abcdefgh'));
    held.mark(prompt(8), 3);
    const first = held.take();
    expect(texts(first)).toEqual(['abcde']);
    expect(placed(first)).toEqual([[8, 5]]);
    const second = held.take();
    expect(texts(second)).toEqual(['fgh']);
    expect(held.bytes()).toBe(0);
  });

  it('gives several marks that stand at one place, and the ones before it, each with its own place, in one take', () => {
    const held = createHeldOutput();
    held.push(chunk('abcd'));
    held.mark(prompt(2), 2);
    held.mark(prompt(4), 0);
    held.mark(prompt(4, { kind: 'input-start' }), 0);
    const taken = held.take();
    expect(texts(taken)).toEqual(['ab']);
    expect(placed(taken)).toEqual([[2, 2]]);
    const next = held.take();
    expect(texts(next)).toEqual(['cd']);
    expect(placed(next)).toEqual([[4, 2], [4, 2]]);
  });

  it('hands a mark that arrives when every byte was taken over with the next take, which holds no bytes, and cuts nothing after it', () => {
    const held = createHeldOutput();
    held.push(chunk('abcd'));
    expect(held.take().bytes).toBe(4);
    held.mark(prompt(4), 0);
    const marked = held.take();
    expect(marked.chunks).toEqual([]);
    expect(marked.bytes).toBe(0);
    expect(placed(marked)).toEqual([[4, 0]]);
    expect(held.take()).toEqual({ chunks: [], bytes: 0 });
  });

  it('honours the bound of a take and the mark together: a read of at most N bytes stops at N or at the mark, whichever is first, and the marks beyond the stop stay', () => {
    const held = createHeldOutput();
    held.push(chunk('aaaa'));
    held.push(chunk('bbbb'));
    held.push(chunk('cccc'));
    held.mark(prompt(8), 4);
    held.mark(prompt(12), 0);
    const first = held.take(5);
    expect(texts(first), 'the bound is whole chunks: one chunk reaches it').toEqual(['aaaa', 'bbbb']);
    expect(placed(first)).toEqual([[8, 8]]);
    const second = held.take();
    expect(texts(second)).toEqual(['cccc']);
    expect(placed(second)).toEqual([[12, 4]]);
  });

  it('puts a mark that claims more bytes behind it than are held at the start of what is held, and one that stands before what was taken at the next take', () => {
    const held = createHeldOutput();
    held.push(chunk('abcd'));
    held.mark(prompt(1), 99);
    const taken = held.take();
    expect(placed(taken)).toEqual([[1, 0]]);
    expect(texts(taken)).toEqual(['abcd']);
  });

  it('forgets its marks with its bytes when it is cleared, and counts the bytes of a take that was cut', () => {
    const held = createHeldOutput();
    held.push(chunk('abcdef'));
    held.mark(prompt(3), 3);
    held.clear();
    expect(held.take()).toEqual({ chunks: [], bytes: 0 });
    held.push(chunk('xyz'));
    expect(held.take().marks).toBeUndefined();
    held.push(chunk('abcdef'));
    held.mark(prompt(3), 3);
    expect(held.take().bytes).toBe(3);
    expect(held.bytes()).toBe(3);
  });

  it('a take with no marks is what it was: the same object shape, no `marks` member', () => {
    const held = createHeldOutput();
    held.push(chunk('abc'));
    expect(held.take()).toEqual({ chunks: [chunk('abc')], bytes: 3 });
  });
});
