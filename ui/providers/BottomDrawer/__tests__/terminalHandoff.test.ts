import { hasTerminalSessionToOffer, offerTerminalSession, revokeTerminalSession } from '../terminalHandoff';

const mocks = vi.hoisted(() => ({ offerSession: vi.fn(), revokeSession: vi.fn() }));

vi.mock('@omniviewdev/runtime/api', () => ({
  ExecClient: { OfferSession: mocks.offerSession, RevokeSession: mocks.revokeSession },
}));

// A session belongs to the window that opened it, and another window cannot attach it (docs/ui-next/status/T2c-go.md):
// the window that moves a terminal tab offers its session first, so that the window that mounts the tab and attaches
// the session holds it from then on. A move that cannot offer the session does not go on.
describe('offerTerminalSession', () => {
  beforeEach(() => {
    mocks.offerSession.mockReset();
  });

  it('offers the session of a terminal tab to the next window that attaches it', async () => {
    mocks.offerSession.mockResolvedValue(undefined);

    await offerTerminalSession({ id: 'session-1', variant: 'terminal' });

    expect(mocks.offerSession).toHaveBeenCalledTimes(1);
    expect(mocks.offerSession).toHaveBeenCalledWith('session-1');
  });

  it('offers nothing for a tab that is not a session of a terminal', async () => {
    await offerTerminalSession({ id: 'pending-3', variant: 'terminal' });
    await offerTerminalSession({ id: 'log-session', variant: 'logs' });
    await offerTerminalSession({ id: 'build', variant: 'devbuild' });

    expect(mocks.offerSession).not.toHaveBeenCalled();
  });

  it('offers nothing for a terminal whose session has expired: it has no live session, and its move goes on', async () => {
    await expect(offerTerminalSession({ id: 'session-2', variant: 'terminal', properties: { status: 'expired' } })).resolves.toBeUndefined();

    expect(mocks.offerSession).not.toHaveBeenCalled();
  });

  it('rejects with the error of the host when the offer fails, so that the move does not go on', async () => {
    const hostError = new Error('session not found');
    mocks.offerSession.mockRejectedValue(hostError);

    await expect(offerTerminalSession({ id: 'session-1', variant: 'terminal' })).rejects.toBe(hostError);

    expect(mocks.offerSession).toHaveBeenCalledWith('session-1');
  });
});

// The window that offered the session and then did not move the tab takes its offer back: the offer stays open for a
// minute for any window that knows the session id. It runs in a failure path, so it never rejects.
describe('revokeTerminalSession', () => {
  beforeEach(() => {
    mocks.revokeSession.mockReset();
    mocks.revokeSession.mockResolvedValue(undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('takes back the offer of the session of a terminal tab', async () => {
    await revokeTerminalSession({ id: 'session-1', variant: 'terminal' });

    expect(mocks.revokeSession).toHaveBeenCalledTimes(1);
    expect(mocks.revokeSession).toHaveBeenCalledWith('session-1');
  });

  it('revokes nothing for a tab that has no live session to offer', async () => {
    await revokeTerminalSession({ id: 'pending-3', variant: 'terminal' });
    await revokeTerminalSession({ id: 'log-session', variant: 'logs' });
    await revokeTerminalSession({ id: 'session-2', variant: 'terminal', properties: { status: 'expired' } });

    expect(mocks.revokeSession).not.toHaveBeenCalled();
  });

  it('never rejects: a failed revoke is logged and left to run out by itself', async () => {
    const hostError = new Error('session not found');
    mocks.revokeSession.mockRejectedValue(hostError);

    await expect(revokeTerminalSession({ id: 'session-1', variant: 'terminal' })).resolves.toBeUndefined();

    expect(mocks.revokeSession).toHaveBeenCalledWith('session-1');
    expect(console.warn).toHaveBeenCalledTimes(1);
    expect(vi.mocked(console.warn).mock.calls[0]).toContain(hostError);
  });
});

describe('hasTerminalSessionToOffer', () => {
  it.each([
    ['a terminal with a session', { id: 'session-1', variant: 'terminal' }, true],
    ['a terminal with a live status', { id: 'session-1', variant: 'terminal', properties: { status: 'connected' } }, true],
    ['a terminal that has no session yet', { id: 'pending-3', variant: 'terminal' }, false],
    ['a terminal whose session has expired', { id: 'session-2', variant: 'terminal', properties: { status: 'expired' } }, false],
    ['a tab that is not a terminal', { id: 'log-session', variant: 'logs' }, false],
  ])('is decided for %s', (_name, tab, expected) => {
    expect(hasTerminalSessionToOffer(tab)).toBe(expected);
  });
});
