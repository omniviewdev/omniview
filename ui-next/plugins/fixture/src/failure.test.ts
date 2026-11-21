import { afterEach, describe, expect, it } from 'vitest';
import { restartItem } from './failure';

// The fixture's failing page command (O1b-1): Restart on the item's page. It is QUIET unless a check asks (`window.__fixtureDetail` does not exist until a check makes it), so the other checks that press the page's
// commands see what they always saw; with a control that says how, it rejects as the runtime's hooks do (the host's `apperror`, as a `RuntimeError` whose message is its JSON and whose cause is the object), and
// records what it was asked.

const control = (extra: Record<string, unknown> = {}): Record<string, unknown> => {
  const made = { runs: [], ...extra };
  Reflect.set(window, '__fixtureDetail', made);
  return made;
};

afterEach(() => {
  Reflect.deleteProperty(window, '__fixtureDetail');
});

const caught = async (): Promise<Error> => {
  const error: unknown = await restartItem('orders-api').then(
    () => new Error('the command did not fail'),
    (reason: unknown) => reason,
  );
  return error as Error;
};

describe('the fixture\'s Restart', () => {
  it('does nothing while no check asks: no control, no failure', async () => {
    await expect(restartItem('orders-api')).resolves.toBeUndefined();
    control();
    await expect(restartItem('orders-api')).resolves.toBeUndefined();
  });

  it('rejects with the host\'s envelope the way the runtime\'s hooks do: the message is the JSON and the cause is the object (a TIMEOUT: the class\'s title, the plugin\'s one sentence)', async () => {
    control({ failure: 'timeout' });
    const error = await caught();
    expect(error.cause).toMatchObject({ type: 'omniview:resource/timeout', title: 'Timed out', status: 408, detail: 'The cluster did not complete the request in time.', code: 'TIMEOUT' });
    expect(JSON.parse(error.message)).toEqual(error.cause);
  });

  it('fails with a class whose words are the host\'s when it is told to: FORBIDDEN', async () => {
    control({ failure: 'forbidden' });
    expect((await caught()).cause).toMatchObject({ type: 'omniview:resource/forbidden', title: 'Access denied', status: 403, detail: 'The operation is not permitted.', code: 'FORBIDDEN' });
  });

  it('fails with an error that is not the host\'s envelope when it is told to, whose text must never reach the screen', async () => {
    control({ failure: 'generic' });
    const error = await caught();
    expect(error.cause).toBeUndefined();
    expect(error.message).toContain('password=hunter2');
  });

  it('fails with a cancellation when it is told to', async () => {
    control({ failure: 'cancelled' });
    expect((await caught()).name).toBe('AbortError');
  });

  it('records every run with the item it was asked on, for the check to read', async () => {
    const made = control({ failure: 'timeout' });
    await caught();
    await restartItem('proxy').catch(() => undefined);
    expect(made.runs).toEqual([{ item: 'orders-api' }, { item: 'proxy' }]);
  });
});
