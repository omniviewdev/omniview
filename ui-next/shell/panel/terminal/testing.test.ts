import { describe, expect, it } from 'vitest';
import { fakeTerminalFeed } from './testing';

// The fake feed of the tests keeps the contract of a real one for what a close reads of the typing: `inputs` counts the calls of the typing that the feed TOOK, as `execFeed.ts` does (a call with nothing typed is not
// one, and nothing typed after the feed was closed or the session is over is taken), while `typed` is the record of every call that was made. A fake that counted more would let a test pass on a rule the real feed does
// not keep.

describe('the fake feed\'s count of what was typed (`inputs`)', () => {
  it('counts each write that has something typed in it, and not an empty one, while `typed` records every call', () => {
    const feed = fakeTerminalFeed();
    feed.write('l');
    feed.write('');
    feed.write('s');
    expect(feed.inputs?.()).toBe(2);
    expect(feed.typed()).toEqual(['l', '', 's']);
  });

  it('counts what is typed while the process is starting', () => {
    const feed = fakeTerminalFeed({ state: 'starting' });
    feed.write('a');
    expect(feed.inputs?.()).toBe(1);
  });

  it('does not count what is typed after the feed was closed, and records it all the same', async () => {
    const feed = fakeTerminalFeed();
    feed.write('a');
    await feed.close();
    feed.write('b');
    expect(feed.inputs?.()).toBe(1);
    expect(feed.typed()).toEqual(['a', 'b']);
  });

  it('does not count what is typed once the session is over, ended or failed: a real feed ignores it', () => {
    for (const state of ['ended', 'failed'] as const) {
      const feed = fakeTerminalFeed();
      feed.write('a');
      feed.set({ state });
      feed.write('b');
      expect(feed.inputs?.()).toBe(1);
      expect(feed.typed()).toEqual(['a', 'b']);
    }
  });
});
