import { render, cleanup, act, fireEvent } from '@testing-library/react';

// ─── Mocks ─────────────────────────────────────────────────────────────────────
const mocks = vi.hoisted(() => {
  const eventBusHandlers: Record<string, Function> = {};
  const mockChannelOn = vi.fn((event: string, handler: Function) => {
    eventBusHandlers[event] = handler;
    return vi.fn(); // unsubscribe
  });

  return {
    eventBusHandlers,
    mockUseBottomDrawer: vi.fn(),
    mockEventsOn: vi.fn(() => vi.fn()),
    mockChannelEmit: vi.fn(),
    mockChannelOn,
  };
});

vi.mock('@omniviewdev/runtime', () => ({
  useBottomDrawer: () => mocks.mockUseBottomDrawer(),
}));

vi.mock('@omniviewdev/runtime/runtime', () => ({
  EventsOn: mocks.mockEventsOn,
}));

vi.mock('@/providers/BottomDrawer/events', () => ({
  bottomDrawerChannel: {
    emit: (...args: [string, ...any[]]) => mocks.mockChannelEmit(...args),
    on: (event: string, handler: Function) => mocks.mockChannelOn(event, handler),
  },
}));

// Mock child components to keep tests focused on the drawer container
vi.mock('@/providers/BottomDrawer/tabs', () => {
  const MockTabs = (props: any) => (
    <div data-testid="bottom-drawer-tabs" data-props={JSON.stringify({
      hasTabs: props.hasTabs,
      isMinimized: props.isMinimized,
      isFullscreen: props.isFullscreen,
    })}>
      <button data-testid="btn-minimize" onClick={props.onMinimize}>minimize</button>
      <button data-testid="btn-expand" onClick={props.onExpand}>expand</button>
      <button data-testid="btn-fullscreen" onClick={props.onFullscreen}>fullscreen</button>
    </div>
  );
  return { __esModule: true, default: MockTabs };
});

vi.mock('@/providers/BottomDrawer/containers/Terminal', () => {
  return { __esModule: true, default: ({ sessionId }: { sessionId: string }) => <div data-testid={`terminal-${sessionId}`} /> };
});

vi.mock('@/providers/BottomDrawer/containers/LogViewer', () => {
  return { __esModule: true, default: ({ sessionId }: { sessionId: string }) => <div data-testid={`logviewer-${sessionId}`} /> };
});

vi.mock('@/providers/BottomDrawer/containers/DevBuildViewer', () => {
  return { __esModule: true, default: ({ pluginId }: { pluginId: string }) => <div data-testid={`devbuild-${pluginId}`} /> };
});

vi.mock('@/providers/BottomDrawer/containers/PluginLogViewer', () => {
  return { __esModule: true, default: ({ pluginId }: { pluginId: string }) => <div data-testid={`pluginlogs-${pluginId}`} /> };
});

// MUI needs theme
vi.mock('@mui/material/styles', async () => ({
  ...(await vi.importActual<typeof import('@mui/material/styles')>('@mui/material/styles')),
  useTheme: () => ({
    palette: { primary: { 400: '#aaa' } },
  }),
}));

import BottomDrawerContainer from '../../BottomDrawer/index';

const drawerModeStorageKey = 'omniview.bottomDrawer.mode';
const drawerExpandedHeightStorageKey = 'omniview.bottomDrawer.expandedHeight';

describe('BottomDrawerContainer', () => {
  const defaultDrawerState = {
    tabs: [] as any[],
    focused: 0,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(mocks.eventBusHandlers).forEach(k => delete mocks.eventBusHandlers[k]);
    mocks.mockUseBottomDrawer.mockReturnValue(defaultDrawerState);
    localStorage.clear();
    // Reset window.innerHeight
    Object.defineProperty(window, 'innerHeight', { value: 900, writable: true });
  });

  afterEach(() => {
    cleanup();
  });

  it('renders at minHeight (32px) when no tabs', () => {
    const { container } = render(<BottomDrawerContainer />);
    const drawer = container.querySelector('.BottomDrawer') as HTMLElement;
    expect(drawer).toBeTruthy();
    // Initial state — minHeight should be 32px
    expect(drawer.style.height).toBe('32px');
  });

  it('starts minimized with tabs when no saved startup state exists', () => {
    mocks.mockUseBottomDrawer.mockReturnValue({
      tabs: [{ id: 'tab1', title: 'Term', variant: 'terminal', icon: 'LuTerminal' }],
      focused: 0,
    });

    const { container } = render(<BottomDrawerContainer />);
    const drawer = container.querySelector('.BottomDrawer') as HTMLElement;
    expect(drawer.style.height).toBe('32px');
  });

  it('restores saved expanded height when tabs exist on startup', () => {
    localStorage.setItem(drawerModeStorageKey, 'expanded');
    localStorage.setItem(drawerExpandedHeightStorageKey, '520');

    mocks.mockUseBottomDrawer.mockReturnValue({
      tabs: [{ id: 'tab1', title: 'Term', variant: 'terminal', icon: 'LuTerminal' }],
      focused: 0,
    });

    const { container } = render(<BottomDrawerContainer />);
    const drawer = container.querySelector('.BottomDrawer') as HTMLElement;
    expect(drawer.style.height).toBe('520px');
  });

  it('forces minimized startup when saved state is expanded but there are no tabs', () => {
    localStorage.setItem(drawerModeStorageKey, 'expanded');
    localStorage.setItem(drawerExpandedHeightStorageKey, '520');

    const { container } = render(<BottomDrawerContainer />);
    const drawer = container.querySelector('.BottomDrawer') as HTMLElement;
    expect(drawer.style.height).toBe('32px');
  });

  it('expands to defaultHeight when tabs appear', () => {
    // Start with no tabs
    const { container, rerender } = render(<BottomDrawerContainer />);

    // Now simulate tabs appearing
    mocks.mockUseBottomDrawer.mockReturnValue({
      tabs: [{ id: 'tab1', title: 'Term', variant: 'terminal', icon: 'LuTerminal' }],
      focused: 0,
    });
    rerender(<BottomDrawerContainer />);

    const drawer = container.querySelector('.BottomDrawer') as HTMLElement;
    expect(drawer.style.height).toBe('400px');
  });

  it('minimize collapses to minHeight', () => {
    mocks.mockUseBottomDrawer.mockReturnValue({
      tabs: [{ id: 'tab1', title: 'Term', variant: 'terminal', icon: 'LuTerminal' }],
      focused: 0,
    });

    const { container, getByTestId } = render(<BottomDrawerContainer />);

    // Click minimize
    act(() => {
      fireEvent.click(getByTestId('btn-minimize'));
    });

    const drawer = container.querySelector('.BottomDrawer') as HTMLElement;
    expect(drawer.style.height).toBe('32px');
  });

  it('expand restores last expanded height', () => {
    // Start with no tabs so drawer is at minHeight
    const { container, getByTestId, rerender } = render(<BottomDrawerContainer />);

    // Simulate tabs appearing — triggers expansion to 400px
    mocks.mockUseBottomDrawer.mockReturnValue({
      tabs: [{ id: 'tab1', title: 'Term', variant: 'terminal', icon: 'LuTerminal' }],
      focused: 0,
    });
    rerender(<BottomDrawerContainer />);

    const drawer = container.querySelector('.BottomDrawer') as HTMLElement;
    expect(drawer.style.height).toBe('400px');

    // Minimize
    act(() => {
      fireEvent.click(getByTestId('btn-minimize'));
    });
    expect(drawer.style.height).toBe('32px');

    // Expand should restore to 400px
    act(() => {
      fireEvent.click(getByTestId('btn-expand'));
    });
    expect(drawer.style.height).toBe('400px');
  });

  it('fullscreen sets height to window.innerHeight', () => {
    mocks.mockUseBottomDrawer.mockReturnValue({
      tabs: [{ id: 'tab1', title: 'Term', variant: 'terminal', icon: 'LuTerminal' }],
      focused: 0,
    });

    const { container, getByTestId } = render(<BottomDrawerContainer />);

    act(() => {
      fireEvent.click(getByTestId('btn-fullscreen'));
    });

    const drawer = container.querySelector('.BottomDrawer') as HTMLElement;
    expect(drawer.style.height).toBe('900px');
  });

  it('fullscreen toggle restores previous height', () => {
    mocks.mockUseBottomDrawer.mockReturnValue({
      tabs: [{ id: 'tab1', title: 'Term', variant: 'terminal', icon: 'LuTerminal' }],
      focused: 0,
    });

    const { container, getByTestId } = render(<BottomDrawerContainer />);
    const drawer = container.querySelector('.BottomDrawer') as HTMLElement;

    // Go fullscreen
    act(() => {
      fireEvent.click(getByTestId('btn-fullscreen'));
    });
    expect(drawer.style.height).toBe('900px');

    // Un-fullscreen should restore to previous height (400px default)
    act(() => {
      fireEvent.click(getByTestId('btn-fullscreen'));
    });
    expect(drawer.style.height).toBe('400px');
  });

  it('passes correct isMinimized and isFullscreen props to tabs', () => {
    // Start with no tabs, then add tabs to trigger expansion
    const { getByTestId, rerender } = render(<BottomDrawerContainer />);

    mocks.mockUseBottomDrawer.mockReturnValue({
      tabs: [{ id: 'tab1', title: 'Term', variant: 'terminal', icon: 'LuTerminal' }],
      focused: 0,
    });
    rerender(<BottomDrawerContainer />);

    const tabsEl = getByTestId('bottom-drawer-tabs');
    const props = JSON.parse(tabsEl.getAttribute('data-props')!);
    expect(props.hasTabs).toBe(true);
    expect(props.isMinimized).toBe(false);
    expect(props.isFullscreen).toBe(false);
  });

  it('double-click drag handle toggles min/default', () => {
    // Start with no tabs, then add tabs to get inline style set
    const { container, rerender } = render(<BottomDrawerContainer />);

    mocks.mockUseBottomDrawer.mockReturnValue({
      tabs: [{ id: 'tab1', title: 'Term', variant: 'terminal', icon: 'LuTerminal' }],
      focused: 0,
    });
    rerender(<BottomDrawerContainer />);

    const drawer = container.querySelector('.BottomDrawer') as HTMLElement;
    const dragHandle = drawer.querySelector('[data-testid="bottom-drawer-drag-handle"]') as HTMLElement;
    expect(dragHandle).toBeTruthy();

    // Drawer starts at 400px from tab expansion
    expect(drawer.style.height).toBe('400px');

    // Double-click to minimize
    act(() => {
      fireEvent.click(dragHandle, { detail: 2 });
    });
    expect(drawer.style.height).toBe('32px');

    // Double-click again to restore default
    act(() => {
      fireEvent.click(dragHandle, { detail: 2 });
    });
    expect(drawer.style.height).toBe('400px');
  });

  it('does not expand when there are no tabs', () => {
    const { container, getByTestId } = render(<BottomDrawerContainer />);
    const drawer = container.querySelector('.BottomDrawer') as HTMLElement;
    const dragHandle = getByTestId('bottom-drawer-drag-handle');
    const onResize = mocks.eventBusHandlers['onResize'];

    expect(drawer.style.height).toBe('32px');

    act(() => {
      fireEvent.click(getByTestId('btn-expand'));
      fireEvent.click(getByTestId('btn-fullscreen'));
      fireEvent.click(dragHandle, { detail: 2 });
      if (onResize) {
        onResize(600);
      }
    });

    expect(drawer.style.height).toBe('32px');
  });

  it('event bus onResize sets height', () => {
    mocks.mockUseBottomDrawer.mockReturnValue({
      tabs: [{ id: 'tab1', title: 'Term', variant: 'terminal', icon: 'LuTerminal' }],
      focused: 0,
    });

    const { container } = render(<BottomDrawerContainer />);

    // The on handler for 'onResize' should have been registered
    expect(mocks.eventBusHandlers['onResize']).toBeDefined();

    act(() => {
      mocks.eventBusHandlers['onResize'](600);
    });

    const drawer = container.querySelector('.BottomDrawer') as HTMLElement;
    expect(drawer.style.height).toBe('600px');
  });

  it('event bus onFullscreen sets height to window.innerHeight', () => {
    mocks.mockUseBottomDrawer.mockReturnValue({
      tabs: [{ id: 'tab1', title: 'Term', variant: 'terminal', icon: 'LuTerminal' }],
      focused: 0,
    });

    const { container } = render(<BottomDrawerContainer />);

    expect(mocks.eventBusHandlers['onFullscreen']).toBeDefined();

    act(() => {
      mocks.eventBusHandlers['onFullscreen']();
    });

    const drawer = container.querySelector('.BottomDrawer') as HTMLElement;
    expect(drawer.style.height).toBe('900px');
  });

  it('event bus onMinimize sets height to minHeight', () => {
    mocks.mockUseBottomDrawer.mockReturnValue({
      tabs: [{ id: 'tab1', title: 'Term', variant: 'terminal', icon: 'LuTerminal' }],
      focused: 0,
    });

    const { container } = render(<BottomDrawerContainer />);

    expect(mocks.eventBusHandlers['onMinimize']).toBeDefined();

    act(() => {
      mocks.eventBusHandlers['onMinimize']();
    });

    const drawer = container.querySelector('.BottomDrawer') as HTMLElement;
    expect(drawer.style.height).toBe('32px');
  });

  it('minHeight stays at 32px floor when expanded', () => {
    const { container, rerender } = render(<BottomDrawerContainer />);

    mocks.mockUseBottomDrawer.mockReturnValue({
      tabs: [{ id: 'tab1', title: 'Term', variant: 'terminal', icon: 'LuTerminal' }],
      focused: 0,
    });
    rerender(<BottomDrawerContainer />);

    const drawer = container.querySelector('.BottomDrawer') as HTMLElement;

    // Expanded to 400px — minHeight should still be 32px (the floor)
    expect(drawer.style.height).toBe('400px');
    expect(drawer.style.minHeight).toBe('32px');
    expect(drawer.style.maxHeight).toBe('400px');
  });

  it('minHeight stays at 32px floor when fullscreen', () => {
    mocks.mockUseBottomDrawer.mockReturnValue({
      tabs: [{ id: 'tab1', title: 'Term', variant: 'terminal', icon: 'LuTerminal' }],
      focused: 0,
    });

    const { container, getByTestId } = render(<BottomDrawerContainer />);

    act(() => {
      fireEvent.click(getByTestId('btn-fullscreen'));
    });

    const drawer = container.querySelector('.BottomDrawer') as HTMLElement;
    expect(drawer.style.height).toBe('900px');
    expect(drawer.style.minHeight).toBe('32px');
    expect(drawer.style.maxHeight).toBe('900px');
  });

  it('all height properties lock to 32px when minimized', () => {
    mocks.mockUseBottomDrawer.mockReturnValue({
      tabs: [{ id: 'tab1', title: 'Term', variant: 'terminal', icon: 'LuTerminal' }],
      focused: 0,
    });

    const { container, getByTestId } = render(<BottomDrawerContainer />);

    act(() => {
      fireEvent.click(getByTestId('btn-minimize'));
    });

    const drawer = container.querySelector('.BottomDrawer') as HTMLElement;
    expect(drawer.style.height).toBe('32px');
    expect(drawer.style.minHeight).toBe('32px');
    expect(drawer.style.maxHeight).toBe('32px');
  });

  it('renders terminal container for terminal tab variant', () => {
    mocks.mockUseBottomDrawer.mockReturnValue({
      tabs: [{ id: 'sess-1', title: 'Term', variant: 'terminal', icon: 'LuTerminal' }],
      focused: 0,
    });

    const { getByTestId } = render(<BottomDrawerContainer />);
    expect(getByTestId('terminal-sess-1')).toBeTruthy();
  });

  it('renders log viewer for logs tab variant', () => {
    mocks.mockUseBottomDrawer.mockReturnValue({
      tabs: [{ id: 'log-1', title: 'Logs', variant: 'logs', icon: 'LuLogs' }],
      focused: 0,
    });

    const { getByTestId } = render(<BottomDrawerContainer />);
    expect(getByTestId('logviewer-log-1')).toBeTruthy();
  });
});
