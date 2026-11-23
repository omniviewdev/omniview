import { createWailsTabDragTransport } from './transport';

const mocks = vi.hoisted(() => ({
  offerSession: vi.fn(),
  beginDrag: vi.fn(),
  moveDrag: vi.fn(),
}));

vi.mock('@omniviewdev/runtime/api', () => ({
  WindowClient: {
    BeginDrag: mocks.beginDrag,
    MoveDrag: mocks.moveDrag,
    EndDrag: vi.fn(),
    CancelDrag: vi.fn(),
    RespondDrop: vi.fn(),
  },
  ExecClient: { OfferSession: mocks.offerSession },
}));

vi.mock('@omniviewdev/runtime/runtime', () => ({
  Events: { On: vi.fn(() => () => undefined) },
}));

vi.mock('./identity', () => ({
  currentWindow: { name: 'window-a' },
}));

const pointer = { clientX: 4, clientY: 8, screenX: 4, screenY: 8 };

function dragOf(dragType: string, id: string, variant: string) {
  return {
    dragType,
    sourceInstanceId: 'drawer-window-a',
    tab: { id, title: id, payload: { id, title: id, variant } },
  };
}

// A drawer tab that is dragged to another window carries its session, and a window cannot attach a session that
// another window holds (docs/ui-next/status/T2c-go.md): the window that drags it offers it as the drag begins,
// before the window under the pointer can attach it.
describe('the tab drag transport', () => {
  beforeEach(() => {
    mocks.offerSession.mockReset();
    mocks.beginDrag.mockReset();
    mocks.moveDrag.mockReset();
    mocks.offerSession.mockResolvedValue(undefined);
    mocks.beginDrag.mockResolvedValue(undefined);
    mocks.moveDrag.mockResolvedValue(undefined);
  });

  it('offers the session of a terminal tab that is dragged, before the drag begins', async () => {
    createWailsTabDragTransport().begin('drag-1', dragOf('omniview/drawer-tab', 'session-1', 'terminal'), pointer);

    await vi.waitFor(() => {
      expect(mocks.beginDrag).toHaveBeenCalledTimes(1);
    });
    expect(mocks.offerSession).toHaveBeenCalledTimes(1);
    expect(mocks.offerSession).toHaveBeenCalledWith('session-1');
    expect(mocks.offerSession.mock.invocationCallOrder[0]).toBeLessThan(mocks.beginDrag.mock.invocationCallOrder[0]);
    expect(mocks.beginDrag).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'drag-1', sourceWindow: 'window-a', dragType: 'omniview/drawer-tab' }));
  });

  it('offers nothing for a page tab, a tab that is not a terminal, or a terminal that has no session yet', async () => {
    const transport = createWailsTabDragTransport();
    transport.begin('drag-2', dragOf('omniview/page-tab', 'page-1', 'terminal'), pointer);
    transport.begin('drag-3', dragOf('omniview/drawer-tab', 'log-1', 'logs'), pointer);
    transport.begin('drag-4', dragOf('omniview/drawer-tab', 'pending-9', 'terminal'), pointer);

    await vi.waitFor(() => {
      expect(mocks.beginDrag).toHaveBeenCalledTimes(3);
    });
    expect(mocks.offerSession).not.toHaveBeenCalled();
  });

  it('begins the drag when the offer fails', async () => {
    mocks.offerSession.mockRejectedValue(new Error('the host said no'));

    createWailsTabDragTransport().begin('drag-5', dragOf('omniview/drawer-tab', 'session-2', 'terminal'), pointer);

    await vi.waitFor(() => {
      expect(mocks.beginDrag).toHaveBeenCalledTimes(1);
    });
    expect(mocks.offerSession).toHaveBeenCalledWith('session-2');
  });
});
