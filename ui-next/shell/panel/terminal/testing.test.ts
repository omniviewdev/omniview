import { describe, expect, it, vi } from 'vitest';
import { fakeChannels, fakeTerminalFeed, goneError } from './testing';

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

// The fake of the terminal channel keeps the contract of channel.ts for what the feed is tested against: a stream is over after one of the four ends or after the feed closed it, the feed's frames after that are dropped and
// counted, and the host's (the test's) are a mistake that throws. A fake that let a test speak on a stream that is over would let a feed pass on a frame the host could never have sent.

describe('the fake terminal channel', () => {
  const connected = () => {
    const channels = fakeChannels();
    const events = { ready: vi.fn(), output: vi.fn(), gap: vi.fn(), ended: vi.fn(), applied: vi.fn(), takenOver: vi.fn(), released: vi.fn(), unsupported: vi.fn(), notFound: vi.fn(), closed: vi.fn() };
    const link = channels.connect('term-1', 7, events);
    return { channels, events, link, stream: channels.stream() };
  };

  it('opens a stream for the id and the offset the feed asked from, and says ready with the payload of the host', () => {
    const { events, stream } = connected();
    expect(stream.id).toBe('term-1');
    expect(stream.fromOffset).toBe(7);
    stream.ready({ start: 3, end: 9, lost: 1, size: { cols: 100, rows: 30 } });
    expect(events.ready).toHaveBeenCalledWith(expect.objectContaining({ v: 2, input_applied: 0, start: 3, end: 9, lost: 1, size: { cols: 100, rows: 30 }, start_size: { cols: 100, rows: 30 }, ended: null }));
  });

  it('records what the feed sent, in order, and what was typed', () => {
    const { link, stream } = connected();
    link.ack(0);
    link.input(new TextEncoder().encode('ls'));
    link.resize(90, 30);
    link.input(new TextEncoder().encode('\r'));
    link.detach();
    expect(stream.sent().map((frame) => frame.kind)).toEqual(['ack', 'input', 'resize', 'input', 'detach']);
    expect(stream.typed()).toBe('ls\r');
    expect(stream.acks()).toEqual([0]);
  });

  it('is over after each end the host can send, and after the feed closed it: the feed\'s frames are dropped and counted, and the test\'s throw', () => {
    for (const end of ['ended', 'unsupported', 'notFound', 'drop'] as const) {
      const { link, stream } = connected();
      stream[end]();
      expect(stream.open()).toBe(false);
      link.ack(1);
      expect(stream.dropped()).toBe(1);
      expect(stream.sent()).toEqual([]);
      expect(() => {
        stream.output(0, 'x');
      }).toThrow('over');
    }

    const { link, stream } = connected();
    link.close();
    expect(stream.closedByFeed()).toBe(true);
    link.input(new Uint8Array([1]));
    expect(stream.dropped()).toBe(1);
    expect(() => {
      stream.gap(0, 1);
    }).toThrow('over');
  });

  it('keeps a stream the host took the terminal from open as a watcher: the test may send it released or ended and nothing else, and the feed\'s frames are still recorded', () => {
    const { link, events, stream } = connected();
    stream.takenOver();
    expect(events.takenOver).toHaveBeenCalledTimes(1);
    expect(stream.open()).toBe(true);
    for (const speak of [() => stream.output(0, 'x'), () => stream.gap(0, 1), () => stream.applied(1), () => stream.ready(), () => stream.notFound(), () => stream.unsupported(), () => stream.takenOver()]) {
      expect(speak).toThrow('watcher');
    }

    link.detach();
    expect(stream.sent()).toEqual([{ kind: 'detach' }]);
    stream.released();
    expect(events.released).toHaveBeenCalledTimes(1);
    expect(stream.open()).toBe(false);
    const other = connected();
    other.stream.takenOver();
    other.stream.ended();
    expect(other.events.ended).toHaveBeenCalledTimes(1);
    expect(other.stream.open()).toBe(false);
    expect(() => {
      connected().stream.released();
    }).toThrow('holds');
  });

  it('says what the host says to the feed: output as bytes, a gap, the end typed, the host\'s ends', () => {
    const { events, stream } = connected();
    stream.output(4, 'hi');
    stream.gap(6, 20);
    expect(events.output).toHaveBeenCalledWith(4, expect.anything());
    expect([...(events.output.mock.calls[0]?.[1] as Uint8Array)]).toEqual([104, 105]);
    expect(events.gap).toHaveBeenCalledWith(6, 20);
    stream.applied(5);
    expect(events.applied).toHaveBeenCalledWith(5);
    stream.ended();
    expect(events.ended).toHaveBeenCalledWith({ reason: 'exited', exit_code: 0 });
    const refused = connected();
    refused.stream.unsupported(3);
    expect(refused.events.unsupported).toHaveBeenCalledWith(3);
  });

  it('answers its calls with what the test gave, and records them', async () => {
    const channels = fakeChannels({ create: () => ({ shell: { name: 'fish' } }), busy: () => ({ state: 'busy' }), listed: () => ({ attached: true }), list: () => [{ id: 'a' }] });
    expect(await channels.create('a', { cols: 80, rows: 24 })).toEqual({ shell: { name: 'fish' } });
    expect(await channels.busy('a')).toEqual({ state: 'busy' });
    expect(await channels.listed('a')).toEqual({ attached: true });
    expect(await channels.list()).toEqual([{ id: 'a' }]);
    await channels.close('a');
    await channels.dismiss('a');
    expect(channels.calls().map((call) => call.kind)).toEqual(['create', 'busy', 'listed', 'list', 'close', 'dismiss']);
    expect(channels.isGone(goneError())).toBe(true);
    expect(channels.isGone(new Error('x'))).toBe(false);
  });
});
