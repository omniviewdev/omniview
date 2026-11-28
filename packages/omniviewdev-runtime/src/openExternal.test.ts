import { beforeEach, describe, expect, it, vi } from 'vitest';

const world = vi.hoisted(() => ({ open: vi.fn<(address: string) => Promise<{ opened: boolean; reason?: string }>>() }));
vi.mock('./bindings/github.com/omniviewdev/omniview/appservice', () => ({ OpenExternalURL: world.open }));

import { ExternalURLRefusedError, openExternalURL } from './openExternal';

beforeEach(() => {
  world.open.mockReset();
  world.open.mockResolvedValue({ opened: true });
});

describe('opening an address through the host (the host checks it, and the answer is typed)', () => {
  it('gives the host the address as it is, once, and resolves when the host opened it', async () => {
    await expect(openExternalURL('http://localhost:3000/a?b=c')).resolves.toBeUndefined();
    expect(world.open).toHaveBeenCalledTimes(1);
    expect(world.open).toHaveBeenCalledWith('http://localhost:3000/a?b=c');
  });

  it.each(['scheme', 'userinfo', 'own-server', 'malformed', 'too-long'])('is a refusal, with its reason, when the host answers %s: an opened:false is never read as opened', async (reason) => {
    world.open.mockResolvedValue({ opened: false, reason });
    const failure = await openExternalURL('http://127.0.0.1:34115/').then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(ExternalURLRefusedError);
    expect((failure as ExternalURLRefusedError).reason).toBe(reason);
    expect((failure as Error).message).not.toContain('34115');
  });

  it('lets the failure of the call through (the host could not start the browser) as it was', async () => {
    const failed = new Error('the system\'s browser could not be started');
    world.open.mockRejectedValue(failed);
    await expect(openExternalURL('https://example.com/')).rejects.toBe(failed);
  });
});
