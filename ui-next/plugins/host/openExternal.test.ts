import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openExternal } from './openExternal';

// The window's way to open an address outside the app: the host's own call. The runtime's `Browser` is a stand-in that records what it is asked, so what is under test is that the address goes to the host as it is, once, and that the host's
// answer, and its refusal, are the caller's.

const world = vi.hoisted(() => ({ open: vi.fn<(url: string) => Promise<void>>(), direct: vi.fn<(url: string) => Promise<void>>() }));

vi.mock('@omniviewdev/runtime/api', () => ({ openExternalURL: world.open }));
// The runtime's own browser call, which the page no longer makes: the host's opener checks the address, this call does not. A call of it is a failure.
// eslint-disable-next-line @typescript-eslint/naming-convention -- the runtime names its browser call `OpenURL`
vi.mock('@omniviewdev/runtime/runtime', () => ({ Browser: { OpenURL: world.direct } }));

beforeEach(() => {
  world.open.mockReset();
  world.direct.mockReset();
  world.open.mockResolvedValue(undefined);
});

describe('opening an address outside the app', () => {
  it('asks the host to open the address, as it was given, once', async () => {
    await openExternal('http://127.0.0.1:8081');
    expect(world.open).toHaveBeenCalledTimes(1);
    expect(world.open).toHaveBeenCalledWith('http://127.0.0.1:8081');
    expect(world.direct).not.toHaveBeenCalled();
  });

  it('asks nothing until it is called', () => {
    expect(world.open).not.toHaveBeenCalled();
  });

  it('answers when the host has: the call is awaited, so a caller that waits is told after the host', async () => {
    let answered = false;
    world.open.mockImplementation(async () => {
      await Promise.resolve();
      answered = true;
    });
    await openExternal('http://127.0.0.1:8081');
    expect(answered).toBe(true);
  });

  it('is the host\'s refusal when the host refuses (it checks the address again, and a refusal is the call\'s rejection), for the caller to say', async () => {
    world.open.mockRejectedValue(new Error('refused'));
    await expect(openExternal('http://127.0.0.1:8081')).rejects.toThrow('refused');
  });
});
