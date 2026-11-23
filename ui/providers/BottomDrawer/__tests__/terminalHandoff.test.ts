import { offerTerminalSession } from '../terminalHandoff';

const mocks = vi.hoisted(() => ({ offerSession: vi.fn() }));

vi.mock('@omniviewdev/runtime/api', () => ({
  ExecClient: { OfferSession: mocks.offerSession },
}));

// A session belongs to the window that opened it, and another window cannot attach it (docs/ui-next/status/T2c-go.md):
// the window that moves a terminal tab offers its session first, so that the window that mounts the tab and attaches
// the session holds it from then on.
describe('offerTerminalSession', () => {
  beforeEach(() => {
    mocks.offerSession.mockReset();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
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

  it('lets the move go on when the offer fails: the session may have ended, and this window still holds what it holds', async () => {
    mocks.offerSession.mockRejectedValue(new Error('the host said no'));

    await expect(offerTerminalSession({ id: 'session-1', variant: 'terminal' })).resolves.toBeUndefined();

    expect(console.warn).toHaveBeenCalled();
  });

  it('lets the move go on when the host has no OfferSession (a host older than this one)', async () => {
    mocks.offerSession.mockImplementation(() => {
      throw new TypeError('ExecClient.OfferSession is not a function');
    });

    await expect(offerTerminalSession({ id: 'session-1', variant: 'terminal' })).resolves.toBeUndefined();
  });
});
