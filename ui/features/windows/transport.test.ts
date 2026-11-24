import { createWailsTabDragTransport } from './transport';

const mocks = vi.hoisted(() => ({
  offerSession: vi.fn(),
  revokeSession: vi.fn(),
  beginDrag: vi.fn(),
  moveDrag: vi.fn(),
  endDrag: vi.fn(),
  cancelDrag: vi.fn(),
}));

vi.mock('@omniviewdev/runtime/api', () => ({
  WindowClient: {
    BeginDrag: mocks.beginDrag,
    MoveDrag: mocks.moveDrag,
    EndDrag: mocks.endDrag,
    CancelDrag: mocks.cancelDrag,
    RespondDrop: vi.fn(),
  },
  ExecClient: { OfferSession: mocks.offerSession, RevokeSession: mocks.revokeSession },
}));

vi.mock('@omniviewdev/runtime/runtime', () => ({
  Events: { On: vi.fn(() => () => undefined) },
}));

vi.mock('./identity', () => ({
  currentWindow: { name: 'window-a' },
}));

const pointer = { clientX: 4, clientY: 8, screenX: 4, screenY: 8 };
const farPointer = { clientX: 40, clientY: 80, screenX: 40, screenY: 80 };
const TEN_MINUTES = 10 * 60 * 1000;

function dragOf(dragType: string, id: string, variant: string, properties?: Record<string, unknown>) {
  return {
    dragType,
    sourceInstanceId: 'drawer-window-a',
    tab: { id, title: id, payload: { id, title: id, variant, ...(properties !== undefined && { properties }) } },
  };
}

function terminalDrag(id: string) {
  return dragOf('omniview/drawer-tab', id, 'terminal');
}

// What the drag of a tab that has no live terminal session to offer carries.
const NOT_OFFERED = [
  ['a page tab', dragOf('omniview/page-tab', 'page-1', 'terminal')],
  ['a drawer tab that is not a terminal', dragOf('omniview/drawer-tab', 'log-1', 'logs')],
  ['a terminal that has no session yet', dragOf('omniview/drawer-tab', 'pending-9', 'terminal')],
  ['a terminal whose session has expired', dragOf('omniview/drawer-tab', 'session-3', 'terminal', { status: 'expired' })],
] as const;

// A drawer tab that is dragged to another window carries its session, and a window cannot attach a session that
// another window holds (docs/ui-next/status/T2c-go.md): the window that drags it offers the session when the tab is
// dropped, immediately before the drop reaches the window under the pointer, because that window attaches the session
// as soon as it gets the drop, and an offer is open for a minute only.
describe('the tab drag transport', () => {
  beforeEach(() => {
    mocks.offerSession.mockReset();
    mocks.revokeSession.mockReset();
    mocks.beginDrag.mockReset();
    mocks.moveDrag.mockReset();
    mocks.endDrag.mockReset();
    mocks.cancelDrag.mockReset();
    mocks.offerSession.mockResolvedValue(undefined);
    mocks.revokeSession.mockResolvedValue(undefined);
    mocks.beginDrag.mockResolvedValue(undefined);
    mocks.moveDrag.mockResolvedValue(undefined);
    mocks.endDrag.mockResolvedValue({ accepted: true, targetInstanceId: 'drawer-window-b' });
    mocks.cancelDrag.mockResolvedValue(undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('offers nothing as the drag begins or moves', async () => {
    const transport = createWailsTabDragTransport();
    transport.begin('drag-1', terminalDrag('session-1'), pointer);
    await vi.waitFor(() => {
      expect(mocks.beginDrag).toHaveBeenCalledTimes(1);
    });
    await vi.waitFor(() => {
      expect(mocks.moveDrag).toHaveBeenCalledTimes(1);
    });
    transport.move('drag-1', farPointer);
    await vi.waitFor(() => {
      expect(mocks.moveDrag).toHaveBeenCalledTimes(2);
    });

    expect(mocks.offerSession).not.toHaveBeenCalled();
  });

  it('offers the session once when the tab is dropped, after every move and before the drop reaches the target', async () => {
    // A promise that the test settles by hand, so that the order of two calls does not depend on time.
    const offer = Promise.withResolvers<void>();
    mocks.offerSession.mockReturnValue(offer.promise);
    const transport = createWailsTabDragTransport();
    transport.begin('drag-1', terminalDrag('session-1'), pointer);
    await vi.waitFor(() => {
      expect(mocks.moveDrag).toHaveBeenCalledTimes(1);
    });
    transport.move('drag-1', farPointer);

    const dropped = transport.drop('drag-1', farPointer);

    await vi.waitFor(() => {
      expect(mocks.offerSession).toHaveBeenCalledTimes(1);
    });
    expect(mocks.offerSession).toHaveBeenCalledWith('session-1');
    expect(mocks.moveDrag).toHaveBeenCalledTimes(2);
    expect(Math.max(...mocks.moveDrag.mock.invocationCallOrder)).toBeLessThan(mocks.offerSession.mock.invocationCallOrder[0]);
    expect(mocks.endDrag).not.toHaveBeenCalled();

    offer.resolve();
    await expect(dropped).resolves.toEqual({ targetInstanceId: 'drawer-window-b' });

    expect(mocks.endDrag).toHaveBeenCalledTimes(1);
    expect(mocks.endDrag).toHaveBeenCalledWith('drag-1', 40, 80);
    expect(mocks.offerSession.mock.invocationCallOrder[0]).toBeLessThan(mocks.endDrag.mock.invocationCallOrder[0]);
    expect(mocks.revokeSession).not.toHaveBeenCalled();
  });

  it('offers a drag that lasts longer than the offer stays open when it is dropped, not when it began', async () => {
    vi.useFakeTimers();
    const transport = createWailsTabDragTransport();
    transport.begin('drag-1', terminalDrag('session-1'), pointer);
    await vi.waitFor(() => {
      expect(mocks.beginDrag).toHaveBeenCalledTimes(1);
    });

    await vi.advanceTimersByTimeAsync(TEN_MINUTES);
    expect(mocks.offerSession).not.toHaveBeenCalled();
    await transport.drop('drag-1', farPointer);

    expect(mocks.offerSession).toHaveBeenCalledTimes(1);
    expect(mocks.offerSession.mock.invocationCallOrder[0]).toBeLessThan(mocks.endDrag.mock.invocationCallOrder[0]);
  });

  it('cancels the drag and does not drop it when the offer fails, and the tab is not accepted anywhere', async () => {
    mocks.offerSession.mockRejectedValue(new Error('session not found'));
    const transport = createWailsTabDragTransport();
    transport.begin('drag-1', terminalDrag('session-1'), pointer);

    await expect(transport.drop('drag-1', farPointer)).resolves.toBeNull();

    expect(mocks.offerSession).toHaveBeenCalledWith('session-1');
    expect(mocks.endDrag).not.toHaveBeenCalled();
    expect(mocks.cancelDrag).toHaveBeenCalledTimes(1);
    expect(mocks.cancelDrag).toHaveBeenCalledWith('drag-1');
    expect(console.warn).toHaveBeenCalled();
    expect(mocks.revokeSession).not.toHaveBeenCalled();
  });

  it('offers nothing for a drag that is cancelled, and cancels it', async () => {
    const transport = createWailsTabDragTransport();
    transport.begin('drag-1', terminalDrag('session-1'), pointer);
    await vi.waitFor(() => {
      expect(mocks.beginDrag).toHaveBeenCalledTimes(1);
    });

    transport.cancel('drag-1');

    await vi.waitFor(() => {
      expect(mocks.cancelDrag).toHaveBeenCalledWith('drag-1');
    });
    expect(mocks.offerSession).not.toHaveBeenCalled();
    expect(mocks.endDrag).not.toHaveBeenCalled();
  });

  it.each(NOT_OFFERED)('offers nothing for %s, and the drop reaches the target as before', async (_name, payload) => {
    const transport = createWailsTabDragTransport();
    transport.begin('drag-1', payload, pointer);

    await expect(transport.drop('drag-1', farPointer)).resolves.toEqual({ targetInstanceId: 'drawer-window-b' });

    expect(mocks.offerSession).not.toHaveBeenCalled();
    expect(mocks.endDrag).toHaveBeenCalledWith('drag-1', 40, 80);
    expect(mocks.cancelDrag).not.toHaveBeenCalled();
    expect(mocks.revokeSession).not.toHaveBeenCalled();
  });

  it.each(NOT_OFFERED)('revokes nothing for %s when no window accepted it', async (_name, payload) => {
    mocks.endDrag.mockResolvedValue({ accepted: false, targetInstanceId: '' });
    const transport = createWailsTabDragTransport();
    transport.begin('drag-1', payload, pointer);

    await transport.drop('drag-1', farPointer);

    expect(mocks.revokeSession).not.toHaveBeenCalled();
  });

  it.each(NOT_OFFERED)('revokes nothing for %s when its drop fails', async (_name, payload) => {
    const dropError = new Error('drop failed');
    mocks.endDrag.mockRejectedValue(dropError);
    const transport = createWailsTabDragTransport();
    transport.begin('drag-1', payload, pointer);

    await expect(transport.drop('drag-1', farPointer)).rejects.toBe(dropError);

    expect(mocks.revokeSession).not.toHaveBeenCalled();
  });

  it('offers a terminal that is live, whatever its other properties', async () => {
    const transport = createWailsTabDragTransport();
    transport.begin('drag-1', dragOf('omniview/drawer-tab', 'session-4', 'terminal', { status: 'connected' }), pointer);

    await transport.drop('drag-1', farPointer);

    expect(mocks.offerSession).toHaveBeenCalledWith('session-4');
  });

  it('resolves null when no window accepted the tab', async () => {
    mocks.endDrag.mockResolvedValue({ accepted: false, targetInstanceId: '' });
    const transport = createWailsTabDragTransport();
    transport.begin('drag-1', terminalDrag('session-1'), pointer);

    await expect(transport.drop('drag-1', farPointer)).resolves.toBeNull();

    expect(mocks.offerSession).toHaveBeenCalledWith('session-1');
    expect(mocks.endDrag).toHaveBeenCalledTimes(1);
  });

  // The offer was made so that the target could attach the session. A drop that no window accepts, or that fails, is a
  // tab that does not move: the offer is taken back, or it stays open for a minute for any window that knows the id.
  it('takes the offer back when no window accepted the tab: one offer, then one revoke of the same session, and the drop resolves null', async () => {
    mocks.endDrag.mockResolvedValue({ accepted: false, targetInstanceId: '' });
    const transport = createWailsTabDragTransport();
    transport.begin('drag-1', terminalDrag('session-1'), pointer);

    await expect(transport.drop('drag-1', farPointer)).resolves.toBeNull();

    expect(mocks.offerSession).toHaveBeenCalledTimes(1);
    expect(mocks.revokeSession).toHaveBeenCalledTimes(1);
    expect(mocks.revokeSession).toHaveBeenCalledWith('session-1');
    expect(mocks.offerSession.mock.invocationCallOrder[0]).toBeLessThan(mocks.endDrag.mock.invocationCallOrder[0]);
    expect(mocks.endDrag.mock.invocationCallOrder[0]).toBeLessThan(mocks.revokeSession.mock.invocationCallOrder[0]);
  });

  it('takes the offer back when the drop fails, and rejects with the same error', async () => {
    const dropError = new Error('drop failed');
    mocks.endDrag.mockRejectedValue(dropError);
    const transport = createWailsTabDragTransport();
    transport.begin('drag-1', terminalDrag('session-1'), pointer);

    await expect(transport.drop('drag-1', farPointer)).rejects.toBe(dropError);

    expect(mocks.revokeSession).toHaveBeenCalledTimes(1);
    expect(mocks.revokeSession).toHaveBeenCalledWith('session-1');
    expect(mocks.endDrag.mock.invocationCallOrder[0]).toBeLessThan(mocks.revokeSession.mock.invocationCallOrder[0]);
  });

  it('does not let a failed revoke change what the drop resolves: null for a refused drop', async () => {
    mocks.endDrag.mockResolvedValue({ accepted: false, targetInstanceId: '' });
    mocks.revokeSession.mockRejectedValue(new Error('session not found'));
    const transport = createWailsTabDragTransport();
    transport.begin('drag-1', terminalDrag('session-1'), pointer);

    await expect(transport.drop('drag-1', farPointer)).resolves.toBeNull();

    expect(mocks.revokeSession).toHaveBeenCalledTimes(1);
    expect(console.warn).toHaveBeenCalled();
  });

  it('does not let a failed revoke change what the drop resolves: the error of the drop', async () => {
    const dropError = new Error('drop failed');
    mocks.endDrag.mockRejectedValue(dropError);
    mocks.revokeSession.mockRejectedValue(new Error('session not found'));
    const transport = createWailsTabDragTransport();
    transport.begin('drag-1', terminalDrag('session-1'), pointer);

    await expect(transport.drop('drag-1', farPointer)).rejects.toBe(dropError);

    expect(mocks.revokeSession).toHaveBeenCalledTimes(1);
  });
});
