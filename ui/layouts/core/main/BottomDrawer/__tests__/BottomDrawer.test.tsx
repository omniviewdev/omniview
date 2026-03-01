import { render, cleanup, act, fireEvent } from '@testing-library/react';

// ─── Mocks ─────────────────────────────────────────────────────────────────────

const mockUseBottomDrawer = jest.fn();
jest.mock('@omniviewdev/runtime', () => ({
  useBottomDrawer: () => mockUseBottomDrawer(),
}));

const mockEventsOn = jest.fn(() => jest.fn());
jest.mock('@omniviewdev/runtime/runtime', () => ({
  EventsOn: mockEventsOn,
}));

// Capture event bus handlers so tests can invoke them
const eventBusHandlers: Record<string, Function> = {};
const mockChannelEmit = jest.fn();
const mockChannelOn = jest.fn((event: string, handler: Function) => {
  eventBusHandlers[event] = handler;
  return jest.fn(); // unsubscribe
});

jest.mock('@/providers/BottomDrawer/events', () => ({
  bottomDrawerChannel: {
    emit: (...args: [string, ...any[]]) => mockChannelEmit(...args),
    on: (event: string, handler: Function) => mockChannelOn(event, handler),
  },
}));

// Mock child components to keep tests focused on the drawer container
jest.mock('@/providers/BottomDrawer/tabs', () => {
  const MockTabs = (props: any) => (
    <div data-testid="bottom-drawer-tabs" data-props={JSON.stringify({
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

jest.mock('@/providers/BottomDrawer/containers/Terminal', () => {
  return { __esModule: true, default: ({ sessionId }: { sessionId: string }) => <div data-testid={`terminal-${sessionId}`} /> };
});

jest.mock('@/providers/BottomDrawer/containers/LogViewer', () => {
  return { __esModule: true, default: ({ sessionId }: { sessionId: string }) => <div data-testid={`logviewer-${sessionId}`} /> };
});

jest.mock('@/providers/BottomDrawer/containers/DevBuildOutput', () => {
  return { __esModule: true, default: ({ pluginId }: { pluginId: string }) => <div data-testid={`devbuild-${pluginId}`} /> };
});

// MUI needs theme
jest.mock('@mui/material/styles', () => ({
  ...jest.requireActual('@mui/material/styles'),
  useTheme: () => ({
    palette: { primary: { 400: '#aaa' } },
  }),
}));

import BottomDrawerContainer from '../../BottomDrawer/index';

describe('BottomDrawerContainer', () => {
  const defaultDrawerState = {
    tabs: [] as any[],
    focused: 0,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    Object.keys(eventBusHandlers).forEach(k => delete eventBusHandlers[k]);
    mockUseBottomDrawer.mockReturnValue(defaultDrawerState);
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

  it('expands to defaultHeight when tabs appear', () => {
    // Start with no tabs
    const { container, rerender } = render(<BottomDrawerContainer />);

    // Now simulate tabs appearing
    mockUseBottomDrawer.mockReturnValue({
      tabs: [{ id: 'tab1', title: 'Term', variant: 'terminal', icon: 'LuTerminal' }],
      focused: 0,
    });
    rerender(<BottomDrawerContainer />);

    const drawer = container.querySelector('.BottomDrawer') as HTMLElement;
    expect(drawer.style.height).toBe('400px');
  });

  it('minimize collapses to minHeight', () => {
    mockUseBottomDrawer.mockReturnValue({
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
    mockUseBottomDrawer.mockReturnValue({
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
    mockUseBottomDrawer.mockReturnValue({
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
    mockUseBottomDrawer.mockReturnValue({
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

    mockUseBottomDrawer.mockReturnValue({
      tabs: [{ id: 'tab1', title: 'Term', variant: 'terminal', icon: 'LuTerminal' }],
      focused: 0,
    });
    rerender(<BottomDrawerContainer />);

    const tabsEl = getByTestId('bottom-drawer-tabs');
    const props = JSON.parse(tabsEl.getAttribute('data-props')!);
    expect(props.isMinimized).toBe(false);
    expect(props.isFullscreen).toBe(false);
  });

  it('double-click drag handle toggles min/default', () => {
    // Start with no tabs, then add tabs to get inline style set
    const { container, rerender } = render(<BottomDrawerContainer />);

    mockUseBottomDrawer.mockReturnValue({
      tabs: [{ id: 'tab1', title: 'Term', variant: 'terminal', icon: 'LuTerminal' }],
      focused: 0,
    });
    rerender(<BottomDrawerContainer />);

    const drawer = container.querySelector('.BottomDrawer') as HTMLElement;
    const dragHandle = drawer.querySelector('[style*="cursor: row-resize"]') as HTMLElement;
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

  it('event bus onResize sets height', () => {
    mockUseBottomDrawer.mockReturnValue({
      tabs: [{ id: 'tab1', title: 'Term', variant: 'terminal', icon: 'LuTerminal' }],
      focused: 0,
    });

    const { container } = render(<BottomDrawerContainer />);

    // The on handler for 'onResize' should have been registered
    expect(eventBusHandlers['onResize']).toBeDefined();

    act(() => {
      eventBusHandlers['onResize'](600);
    });

    const drawer = container.querySelector('.BottomDrawer') as HTMLElement;
    expect(drawer.style.height).toBe('600px');
  });

  it('event bus onFullscreen sets height to window.innerHeight', () => {
    mockUseBottomDrawer.mockReturnValue({
      tabs: [{ id: 'tab1', title: 'Term', variant: 'terminal', icon: 'LuTerminal' }],
      focused: 0,
    });

    const { container } = render(<BottomDrawerContainer />);

    expect(eventBusHandlers['onFullscreen']).toBeDefined();

    act(() => {
      eventBusHandlers['onFullscreen']();
    });

    const drawer = container.querySelector('.BottomDrawer') as HTMLElement;
    expect(drawer.style.height).toBe('900px');
  });

  it('event bus onMinimize sets height to minHeight', () => {
    mockUseBottomDrawer.mockReturnValue({
      tabs: [{ id: 'tab1', title: 'Term', variant: 'terminal', icon: 'LuTerminal' }],
      focused: 0,
    });

    const { container } = render(<BottomDrawerContainer />);

    expect(eventBusHandlers['onMinimize']).toBeDefined();

    act(() => {
      eventBusHandlers['onMinimize']();
    });

    const drawer = container.querySelector('.BottomDrawer') as HTMLElement;
    expect(drawer.style.height).toBe('32px');
  });

  it('renders terminal container for terminal tab variant', () => {
    mockUseBottomDrawer.mockReturnValue({
      tabs: [{ id: 'sess-1', title: 'Term', variant: 'terminal', icon: 'LuTerminal' }],
      focused: 0,
    });

    const { getByTestId } = render(<BottomDrawerContainer />);
    expect(getByTestId('terminal-sess-1')).toBeTruthy();
  });

  it('renders log viewer for logs tab variant', () => {
    mockUseBottomDrawer.mockReturnValue({
      tabs: [{ id: 'log-1', title: 'Logs', variant: 'logs', icon: 'LuLogs' }],
      focused: 0,
    });

    const { getByTestId } = render(<BottomDrawerContainer />);
    expect(getByTestId('logviewer-log-1')).toBeTruthy();
  });
});
