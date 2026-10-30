import { render, cleanup, act, fireEvent } from '@testing-library/react';

// ─── Mocks ─────────────────────────────────────────────────────────────────────
const mocks = vi.hoisted(() => {
  const eventBusHandlers: Record<string, (...args: unknown[]) => void> = {};
  const mockChannelOn = vi.fn((event: string, handler: (...args: unknown[]) => void) => {
    eventBusHandlers[event] = handler;
    return vi.fn(); // unsubscribe
  });

  return {
    eventBusHandlers,
    mockUseBottomDrawer: vi.fn(),
    mockEventsOn: vi.fn(() => vi.fn()),
    mockChannelEmit: vi.fn(),
    mockChannelOn,
    mockSetBottomDrawerHeight: vi.fn(),
    mockSaveLayout: vi.fn(),
    drawerWindow: {
      restoreComplete: false,
      quietTabIds: new Set<string>(),
      layout: { mode: 'minimized', expandedHeight: 550 },
    },
  };
});

vi.mock('@omniviewdev/runtime', () => ({
  useBottomDrawer: () => mocks.mockUseBottomDrawer(),
}));

vi.mock('@omniviewdev/runtime/runtime', () => ({
  Events: {
    On: mocks.mockEventsOn,
  },
}));

vi.mock('@/providers/BottomDrawer/events', () => ({
  setBottomDrawerHeight: (height: number) => mocks.mockSetBottomDrawerHeight(height),
  bottomDrawerChannel: {
    emit: (...args: [string, ...any[]]) => mocks.mockChannelEmit(...args),
    on: (event: string, handler: (...args: unknown[]) => void) => mocks.mockChannelOn(event, handler),
  },
}));

vi.mock('@/providers/BottomDrawer/windowContext', () => ({
  DEFAULT_DRAWER_EXPANDED_HEIGHT: 550,
  useBottomDrawerWindow: () => ({ ...mocks.drawerWindow, saveLayout: mocks.mockSaveLayout }),
}));

// Mock child components to keep tests focused on the drawer container
vi.mock('@/providers/BottomDrawer/tabs', () => {
  const MockTabs = ({ resizeControls }: any) => (
    <div data-testid="bottom-drawer-tabs" data-props={JSON.stringify({
      isMinimized: resizeControls.isMinimized,
      isFullscreen: resizeControls.isFullscreen,
    })}>
      <button data-testid="btn-minimize" onClick={resizeControls.onMinimize}>minimize</button>
      <button data-testid="btn-expand" onClick={resizeControls.onExpand}>expand</button>
      <button data-testid="btn-fullscreen" onClick={resizeControls.onFullscreen}>fullscreen</button>
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

vi.mock('@/providers/BottomDrawer/containers/EditorDebugPanel', () => {
  return { __esModule: true, default: () => <div data-testid="editor-debug" /> };
});

import BottomDrawerContainer from '../../BottomDrawer/index';

const terminalTab = (id: string) => ({ id, title: 'Term', variant: 'terminal', icon: 'LuTerminal' });

/** The provider finished reconciling restored tabs with the live sessions. */
const finishRestore = (rerender: (ui: React.ReactElement) => void) => {
  mocks.drawerWindow.restoreComplete = true;
  rerender(<BottomDrawerContainer />);
};

describe('BottomDrawerContainer', () => {
  const defaultDrawerState = {
    tabs: [] as any[],
    focused: 0,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(mocks.eventBusHandlers).forEach(k => Reflect.deleteProperty(mocks.eventBusHandlers, k));
    mocks.mockUseBottomDrawer.mockReturnValue(defaultDrawerState);
    mocks.drawerWindow.restoreComplete = false;
    mocks.drawerWindow.quietTabIds = new Set();
    mocks.drawerWindow.layout = { mode: 'minimized', expandedHeight: 550 };
    // Reset window.innerHeight
    Object.defineProperty(window, 'innerHeight', { value: 900, writable: true });
  });

  afterEach(() => {
    cleanup();
  });

  it('renders at minHeight (32px) when no tabs', () => {
    const { container } = render(<BottomDrawerContainer />);
    const drawer = container.querySelector<HTMLElement>('.BottomDrawer')!;
    expect(drawer).toBeTruthy();
    // Initial state — minHeight should be 32px
    expect(drawer.style.height).toBe('32px');
  });

  it('starts minimized with tabs when no saved startup state exists', () => {
    mocks.mockUseBottomDrawer.mockReturnValue({ tabs: [terminalTab('tab1')], focused: 0 });

    const { container } = render(<BottomDrawerContainer />);
    const drawer = container.querySelector<HTMLElement>('.BottomDrawer')!;
    expect(drawer.style.height).toBe('32px');
  });

  it('restores saved expanded height when tabs exist on startup', () => {
    mocks.drawerWindow.layout = { mode: 'expanded', expandedHeight: 520 };
    mocks.mockUseBottomDrawer.mockReturnValue({ tabs: [terminalTab('tab1')], focused: 0 });

    const { container } = render(<BottomDrawerContainer />);
    const drawer = container.querySelector<HTMLElement>('.BottomDrawer')!;
    expect(drawer.style.height).toBe('520px');
  });

  it('forces minimized startup when saved state is expanded but there are no tabs', () => {
    mocks.drawerWindow.layout = { mode: 'expanded', expandedHeight: 520 };

    const { container } = render(<BottomDrawerContainer />);
    const drawer = container.querySelector<HTMLElement>('.BottomDrawer')!;
    expect(drawer.style.height).toBe('32px');
  });

  it('expands to defaultHeight when tabs appear', () => {
    // Start with no tabs
    const { container, rerender } = render(<BottomDrawerContainer />);
    finishRestore(rerender);

    // Now simulate tabs appearing
    mocks.mockUseBottomDrawer.mockReturnValue({ tabs: [terminalTab('tab1')], focused: 0 });
    rerender(<BottomDrawerContainer />);

    const drawer = container.querySelector<HTMLElement>('.BottomDrawer')!;
    expect(drawer.style.height).toBe('550px');
  });

  it('does not expand for tabs adopted quietly after startup', () => {
    const { container, rerender } = render(<BottomDrawerContainer />);
    finishRestore(rerender);

    mocks.drawerWindow.quietTabIds = new Set(['from-closed-window']);
    mocks.mockUseBottomDrawer.mockReturnValue({ tabs: [terminalTab('from-closed-window')], focused: 0 });
    rerender(<BottomDrawerContainer />);

    const drawer = container.querySelector<HTMLElement>('.BottomDrawer')!;
    expect(drawer.style.height).toBe('32px');
  });

  it('does not expand when a retry swaps a tab id in place', () => {
    mocks.mockUseBottomDrawer.mockReturnValue({ tabs: [terminalTab('exec-old')], focused: 0 });
    const { container, getByTestId, rerender } = render(<BottomDrawerContainer />);
    act(() => {
      mocks.eventBusHandlers.onResize(300);
    });

    mocks.mockUseBottomDrawer.mockReturnValue({ tabs: [terminalTab('pending-1')], focused: 0 });
    rerender(<BottomDrawerContainer />);

    const drawer = container.querySelector<HTMLElement>('.BottomDrawer')!;
    expect(drawer.style.height).toBe('300px');
    expect(getByTestId('bottom-drawer-tabs')).toBeTruthy();
  });

  it('minimize collapses to minHeight and saves the mode', () => {
    mocks.mockUseBottomDrawer.mockReturnValue({ tabs: [terminalTab('tab1')], focused: 0 });

    const { container, getByTestId } = render(<BottomDrawerContainer />);

    // Click minimize
    act(() => {
      fireEvent.click(getByTestId('btn-minimize'));
    });

    const drawer = container.querySelector<HTMLElement>('.BottomDrawer')!;
    expect(drawer.style.height).toBe('32px');
    expect(mocks.mockSaveLayout).toHaveBeenLastCalledWith('minimized', undefined);
  });

  it('publishes its height for other panels without touching <html>', () => {
    mocks.mockUseBottomDrawer.mockReturnValue({ tabs: [terminalTab('tab1')], focused: 0 });

    const { getByTestId } = render(<BottomDrawerContainer />);
    act(() => {
      fireEvent.click(getByTestId('btn-fullscreen'));
    });

    expect(mocks.mockSetBottomDrawerHeight).toHaveBeenLastCalledWith(window.innerHeight);
    expect(document.documentElement.style.getPropertyValue('--BottomDrawer-height')).toBe('');
  });

  it('expand restores last expanded height', () => {
    // Start with no tabs so drawer is at minHeight
    const { container, getByTestId, rerender } = render(<BottomDrawerContainer />);
    finishRestore(rerender);

    // Simulate tabs appearing — triggers expansion to 550px
    mocks.mockUseBottomDrawer.mockReturnValue({ tabs: [terminalTab('tab1')], focused: 0 });
    rerender(<BottomDrawerContainer />);

    const drawer = container.querySelector<HTMLElement>('.BottomDrawer')!;
    expect(drawer.style.height).toBe('550px');

    // Minimize
    act(() => {
      fireEvent.click(getByTestId('btn-minimize'));
    });
    expect(drawer.style.height).toBe('32px');

    // Expand should restore to 550px
    act(() => {
      fireEvent.click(getByTestId('btn-expand'));
    });
    expect(drawer.style.height).toBe('550px');
    expect(mocks.mockSaveLayout).toHaveBeenLastCalledWith('expanded', 550);
  });

  it('fullscreen sets height to window.innerHeight', () => {
    mocks.mockUseBottomDrawer.mockReturnValue({ tabs: [terminalTab('tab1')], focused: 0 });

    const { container, getByTestId } = render(<BottomDrawerContainer />);

    act(() => {
      fireEvent.click(getByTestId('btn-fullscreen'));
    });

    const drawer = container.querySelector<HTMLElement>('.BottomDrawer')!;
    expect(drawer.style.height).toBe('900px');
  });

  it('fullscreen toggle restores previous height', () => {
    mocks.mockUseBottomDrawer.mockReturnValue({ tabs: [terminalTab('tab1')], focused: 0 });

    const { container, getByTestId } = render(<BottomDrawerContainer />);
    const drawer = container.querySelector<HTMLElement>('.BottomDrawer')!;

    // Go fullscreen
    act(() => {
      fireEvent.click(getByTestId('btn-fullscreen'));
    });
    expect(drawer.style.height).toBe('900px');

    // Un-fullscreen should restore to previous height (550px default)
    act(() => {
      fireEvent.click(getByTestId('btn-fullscreen'));
    });
    expect(drawer.style.height).toBe('550px');
  });

  it('passes correct isMinimized and isFullscreen props to tabs', () => {
    // Start with no tabs, then add tabs to trigger expansion
    const { getByTestId, rerender } = render(<BottomDrawerContainer />);
    finishRestore(rerender);

    mocks.mockUseBottomDrawer.mockReturnValue({ tabs: [terminalTab('tab1')], focused: 0 });
    rerender(<BottomDrawerContainer />);

    const tabsEl = getByTestId('bottom-drawer-tabs');
    const props = JSON.parse(tabsEl.getAttribute('data-props')!);
    expect(props.isMinimized).toBe(false);
    expect(props.isFullscreen).toBe(false);
  });

  it('double-click drag handle toggles min/default', () => {
    // Start with no tabs, then add tabs to get inline style set
    const { container, rerender } = render(<BottomDrawerContainer />);
    finishRestore(rerender);

    mocks.mockUseBottomDrawer.mockReturnValue({ tabs: [terminalTab('tab1')], focused: 0 });
    rerender(<BottomDrawerContainer />);

    const drawer = container.querySelector<HTMLElement>('.BottomDrawer')!;
    const dragHandle = drawer.querySelector<HTMLElement>('[data-testid="bottom-drawer-drag-handle"]')!;
    expect(dragHandle).toBeTruthy();

    // Drawer starts at 550px from tab expansion
    expect(drawer.style.height).toBe('550px');

    // Double-click to minimize
    act(() => {
      fireEvent.click(dragHandle, { detail: 2 });
    });
    expect(drawer.style.height).toBe('32px');

    // Double-click again to restore default
    act(() => {
      fireEvent.click(dragHandle, { detail: 2 });
    });
    expect(drawer.style.height).toBe('550px');
  });

  it('does not expand when there are no tabs', () => {
    const { container, getByTestId } = render(<BottomDrawerContainer />);
    const drawer = container.querySelector<HTMLElement>('.BottomDrawer')!;
    const dragHandle = getByTestId('bottom-drawer-drag-handle');
    const onResize = mocks.eventBusHandlers.onResize;

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
    mocks.mockUseBottomDrawer.mockReturnValue({ tabs: [terminalTab('tab1')], focused: 0 });

    const { container } = render(<BottomDrawerContainer />);

    // The on handler for 'onResize' should have been registered
    expect(mocks.eventBusHandlers.onResize).toBeDefined();

    act(() => {
      mocks.eventBusHandlers.onResize(600);
    });

    const drawer = container.querySelector<HTMLElement>('.BottomDrawer')!;
    expect(drawer.style.height).toBe('600px');
  });

  it('event bus onFullscreen sets height to window.innerHeight', () => {
    mocks.mockUseBottomDrawer.mockReturnValue({ tabs: [terminalTab('tab1')], focused: 0 });

    const { container } = render(<BottomDrawerContainer />);

    expect(mocks.eventBusHandlers.onFullscreen).toBeDefined();

    act(() => {
      mocks.eventBusHandlers.onFullscreen();
    });

    const drawer = container.querySelector<HTMLElement>('.BottomDrawer')!;
    expect(drawer.style.height).toBe('900px');
  });

  it('event bus onMinimize sets height to minHeight', () => {
    mocks.mockUseBottomDrawer.mockReturnValue({ tabs: [terminalTab('tab1')], focused: 0 });

    const { container } = render(<BottomDrawerContainer />);

    expect(mocks.eventBusHandlers.onMinimize).toBeDefined();

    act(() => {
      mocks.eventBusHandlers.onMinimize();
    });

    const drawer = container.querySelector<HTMLElement>('.BottomDrawer')!;
    expect(drawer.style.height).toBe('32px');
  });

  it('minHeight stays at 32px floor when expanded', () => {
    const { container, rerender } = render(<BottomDrawerContainer />);
    finishRestore(rerender);

    mocks.mockUseBottomDrawer.mockReturnValue({ tabs: [terminalTab('tab1')], focused: 0 });
    rerender(<BottomDrawerContainer />);

    const drawer = container.querySelector<HTMLElement>('.BottomDrawer')!;

    // Expanded to 550px — minHeight should still be 32px (the floor)
    expect(drawer.style.height).toBe('550px');
    expect(drawer.style.minHeight).toBe('32px');
    expect(drawer.style.maxHeight).toBe('550px');
  });

  it('minHeight stays at 32px floor when fullscreen', () => {
    mocks.mockUseBottomDrawer.mockReturnValue({ tabs: [terminalTab('tab1')], focused: 0 });

    const { container, getByTestId } = render(<BottomDrawerContainer />);

    act(() => {
      fireEvent.click(getByTestId('btn-fullscreen'));
    });

    const drawer = container.querySelector<HTMLElement>('.BottomDrawer')!;
    expect(drawer.style.height).toBe('900px');
    expect(drawer.style.minHeight).toBe('32px');
    expect(drawer.style.maxHeight).toBe('900px');
  });

  it('all height properties lock to 32px when minimized', () => {
    mocks.mockUseBottomDrawer.mockReturnValue({ tabs: [terminalTab('tab1')], focused: 0 });

    const { container, getByTestId } = render(<BottomDrawerContainer />);

    act(() => {
      fireEvent.click(getByTestId('btn-minimize'));
    });

    const drawer = container.querySelector<HTMLElement>('.BottomDrawer')!;
    expect(drawer.style.height).toBe('32px');
    expect(drawer.style.minHeight).toBe('32px');
    expect(drawer.style.maxHeight).toBe('32px');
  });

  it('renders terminal container for terminal tab variant', () => {
    mocks.mockUseBottomDrawer.mockReturnValue({ tabs: [terminalTab('sess-1')], focused: 0 });

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

  it('applies the saved expanded height to tabs restored after mount', () => {
    mocks.drawerWindow.layout = { mode: 'expanded', expandedHeight: 300 };

    const { container, rerender } = render(<BottomDrawerContainer />);

    // The restored session shows up after the first render.
    mocks.drawerWindow.quietTabIds = new Set(['sess-1']);
    mocks.mockUseBottomDrawer.mockReturnValue({ tabs: [terminalTab('sess-1')], focused: 0 });
    rerender(<BottomDrawerContainer />);
    finishRestore(rerender);

    const drawer = container.querySelector<HTMLElement>('.BottomDrawer')!;
    expect(drawer.style.height).toBe('300px');
  });

  it('keeps a saved minimized drawer minimized when tabs are restored after mount', () => {
    mocks.drawerWindow.layout = { mode: 'minimized', expandedHeight: 300 };
    mocks.drawerWindow.quietTabIds = new Set(['sess-1']);

    const { container, rerender } = render(<BottomDrawerContainer />);
    mocks.mockUseBottomDrawer.mockReturnValue({ tabs: [terminalTab('sess-1')], focused: 0 });
    rerender(<BottomDrawerContainer />);

    const drawer = container.querySelector<HTMLElement>('.BottomDrawer')!;
    expect(drawer.style.height).toBe('32px');
  });

  it('expands a tab the user opens before the restore finishes', () => {
    const { container, rerender } = render(<BottomDrawerContainer />);
    // Not a restored session: the user opened it while the restore was running.
    mocks.mockUseBottomDrawer.mockReturnValue({ tabs: [terminalTab('pending-1')], focused: 0 });
    rerender(<BottomDrawerContainer />);

    const drawer = container.querySelector<HTMLElement>('.BottomDrawer')!;
    expect(drawer.style.height).toBe('550px');
  });
});
