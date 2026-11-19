import { describe, expect, it } from 'vitest';
import { fakeFeed } from './testing';

// The invented feed the tests of the Logs tool use keeps the contract of a real one, closed included: a feed that was closed holds nothing and reads nothing (the runtime's stream drops its buffer as it
// closes), so a test cannot pass on lines a real feed would not give.

describe('the invented feed', () => {
  it('reads no line once it is closed, whatever it held', () => {
    const feed = fakeFeed({ state: 'streaming' });
    feed.push(2);
    void feed.close();
    expect(feed.read(2)).toEqual({ lines: [], dropped: 0, held: 0 });
    expect(feed.stats().held).toBe(0);
  });
});
