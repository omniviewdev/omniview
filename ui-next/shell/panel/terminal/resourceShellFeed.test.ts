import { describe, expect, it, vi } from 'vitest';
import { openResourceShellFeed, type ResourceShellFrame, type ResourceShellTransport } from './resourceShellFeed';

function transport() {
  const start = Promise.withResolvers<{ id: string; attachment: string; replay: string }>();
  const frames: Array<PromiseWithResolvers<ResourceShellFrame>> = [];
  const service = { create: vi.fn(async () => start.promise), check: vi.fn(async () => true), close: vi.fn(async () => undefined),
    write: vi.fn(async (_id: string, _lease: string, _data: string) => undefined), resize: vi.fn(async () => undefined),
    read: vi.fn(async (_id: string, _attachment: string, _signal: AbortSignal) => {
      const pending = Promise.withResolvers<ResourceShellFrame>(); frames.push(pending); return pending.promise;
    }),
  } satisfies ResourceShellTransport;
  const open = () => openResourceShellFeed(service, 'owner', 'id', '{}');
  return { service, frames, open, attach: () => {
    start.resolve({ id: 'id', attachment: 'native-lease', replay: btoa('before') });
  } };
}

describe('native resource shell feed', () => {
  it('orders replay before private live bytes; attachment checks never touch exec I/O', async () => {
    const { service, frames, open, attach } = transport();
    const { feed, ready, verify } = open();
    expect(feed.read().bytes).toBe(0); expect(await verify()).toBe(false); expect(service.read).not.toHaveBeenCalled();
    attach(); await ready;
    expect(service.read).toHaveBeenCalledTimes(1);
    expect(service.read.mock.calls[0].slice(0, 2)).toEqual(['id', 'native-lease']);
    frames[0].resolve({ state: 'running', data: btoa('after') });
    await service.read.mock.results[0].value;
    expect(feed.read().chunks.map(chunk => String.fromCharCode(...chunk))).toEqual(['before', 'after']);
    expect(await verify()).toBe(true); expect(service.check).toHaveBeenCalledWith('id', 'native-lease', '', expect.any(AbortSignal));
    expect(service.write).not.toHaveBeenCalled(); expect(service.resize).not.toHaveBeenCalled();
    frames[1].resolve({ state: 'detached', data: '' });
    await service.read.mock.results[1].value;
    expect(await verify()).toBe(false); feed.write('never sent');
    expect(service.write).not.toHaveBeenCalled(); await feed.close(); expect(service.close).not.toHaveBeenCalled();
  });

  it('never sends an id-only close; a launch cancelled in flight closes its eventual native attachment', async () => {
    const { service, open, attach } = transport(); const { feed, ready } = open();
    await feed.close(); attach(); await ready;
    expect(service.close).toHaveBeenCalledExactlyOnceWith('id', 'native-lease'); expect(service.read).not.toHaveBeenCalled();
    expect(feed.getSnapshot().state).toBe('ended');
  });

  it('cancels a blocked read, ignores an uncooperative late response and preserves already received output', async () => {
    const { service, open, attach, frames } = transport(); const { feed, ready } = open(); attach(); await ready;
    const signal = service.read.mock.calls[0][2]; await feed.close(); expect(signal.aborted).toBe(true);
    frames[0].resolve({ data: btoa('late'), state: 'running' });
    await service.read.mock.results[0].value;
    expect(feed.read().chunks.map(chunk => String.fromCharCode(...chunk))).toEqual(['before']);
    expect(service.read).toHaveBeenCalledTimes(1); expect(service.close).toHaveBeenCalledTimes(1);
  });

  it('preserves oversized paste order across bounded writes, with only one write in flight', async () => {
    const { service, open, attach } = transport(); const { feed, ready } = open(); attach(); await ready;
    const ack = Promise.withResolvers<undefined>();
    service.write.mockImplementationOnce(async () => ack.promise);
    const bytes = Uint8Array.from({ length: 82_000 }, (_, i) => i % 251);
    feed.writeBinary(bytes); feed.writeBinary(Uint8Array.of(255, 253));
    expect(service.write).toHaveBeenCalledTimes(1);
    ack.resolve(undefined);
    await vi.waitFor(() => {
      expect(service.write).toHaveBeenCalledTimes(4);
    });
    const parts = service.write.mock.calls.map(([id, lease, data]) => {
      expect([id, lease]).toEqual(['id', 'native-lease']);
      const part = atob(data); expect(part.length).toBeLessThanOrEqual(32 * 1024); return part;
    });
    expect(Array.from(parts.join(''), c => c.charCodeAt(0))).toEqual([...bytes, 255, 253]);
    await feed.close();
  });
});
