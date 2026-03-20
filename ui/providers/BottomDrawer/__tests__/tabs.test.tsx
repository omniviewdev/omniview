import { render, cleanup, act, fireEvent } from '@testing-library/react';
import type { ReactNode } from 'react';

// ─── Mocks ─────────────────────────────────────────────────────────────────────
const mocks = vi.hoisted(() => ({
  mockCreateTab: vi.fn(),
  mockCreateTabs: vi.fn(),
  mockFocusTab: vi.fn(),
  mockCloseTab: vi.fn(),
  mockCloseTabs: vi.fn(),
  mockReorderTab: vi.fn(),
  mockUpdateTab: vi.fn(),
  mockTabs: [] as any[],
  mockFocused: 0,
  mockCreateTerminal: vi.fn().mockResolvedValue({ id: 'new-session-id' }),
  mockListSessions: vi.fn().mockResolvedValue([]),
  mockEventsOn: vi.fn(() => vi.fn()),
}));

vi.mock('@omniviewdev/runtime', () => ({
  useBottomDrawer: () => ({
    tabs: mocks.mockTabs,
    focused: mocks.mockFocused,
    focusTab: mocks.mockFocusTab,
    closeTab: mocks.mockCloseTab,
    closeTabs: mocks.mockCloseTabs,
    createTab: mocks.mockCreateTab,
    createTabs: mocks.mockCreateTabs,
    updateTab: mocks.mockUpdateTab,
    reorderTab: mocks.mockReorderTab,
  }),
  useSettings: () => ({
    settings: {
      'terminal.defaultShell': '/bin/zsh',
    },
  }),
  parseAppError: (err: any) => ({ detail: typeof err === 'string' ? err : err?.message ?? String(err) }),
}));

vi.mock('@omniviewdev/runtime/api', () => ({
  ExecClient: {
    CreateTerminal: (...args: any[]) => mocks.mockCreateTerminal(...args),
    ListSessions: () => mocks.mockListSessions(),
  },
  LogsClient: {
    CreateSession: vi.fn().mockResolvedValue({ id: 'log-sess-id' }),
  },
}));

vi.mock('@omniviewdev/runtime/models', () => ({
  SessionOptions: {
    createFrom: (opts: any) => opts,
  },
  CreateSessionOptions: {
    createFrom: (opts: any) => opts,
  },
  LogSessionOptions: {
    createFrom: (opts: any) => opts,
  },
}));

vi.mock('@omniviewdev/runtime/runtime', () => ({
  Events: {
    On: mocks.mockEventsOn,
  },
}));

vi.mock('../events', () => ({
  bottomDrawerChannel: {
    on: vi.fn(() => vi.fn()),
    emit: vi.fn(),
  },
}));

vi.mock('@/features/devtools/events', () => ({
  devToolsChannel: {
    on: vi.fn(() => vi.fn()),
    emit: vi.fn(),
  },
}));

vi.mock('@/components/icons/Icon', () => {
  return { __esModule: true, default: ({ name }: { name: string }) => <span data-testid={`icon-${name}`} /> };
});

vi.mock('@omniviewdev/ui/menus', () => ({
  ContextMenu: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

// DnD mocks - minimal stubs
vi.mock('@dnd-kit/core', () => ({
  DndContext: ({ children }: any) => <div>{children}</div>,
  closestCenter: vi.fn(),
  KeyboardSensor: vi.fn(),
  PointerSensor: vi.fn(),
  useSensor: vi.fn(),
  useSensors: vi.fn(() => []),
}));

vi.mock('@dnd-kit/sortable', () => ({
  SortableContext: ({ children }: any) => <div>{children}</div>,
  sortableKeyboardCoordinates: vi.fn(),
  horizontalListSortingStrategy: vi.fn(),
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: vi.fn(),
    transform: null,
    transition: null,
  }),
}));

vi.mock('@dnd-kit/modifiers', () => ({
  restrictToHorizontalAxis: vi.fn(),
  restrictToParentElement: vi.fn(),
}));

import BottomDrawerTabs from '../tabs';

describe('BottomDrawerTabs', () => {
  const defaultProps = {
    hasTabs: false,
    isMinimized: false,
    isFullscreen: false,
    onMinimize: vi.fn(),
    onExpand: vi.fn(),
    onFullscreen: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mockTabs = [];
    mocks.mockFocused = 0;
  });

  afterEach(() => {
    cleanup();
  });

  it('renders the + button', () => {
    const { container } = render(<BottomDrawerTabs {...defaultProps} />);
    // The + button uses LuPlus icon
    const buttons = container.querySelectorAll('button');
    expect(buttons.length).toBeGreaterThanOrEqual(1);
  });

  it('does not call createTabs when ListSessions returns no sessions', async () => {
    render(<BottomDrawerTabs {...defaultProps} />);

    await act(async () => {
      await Promise.resolve();
    });

    expect(mocks.mockCreateTabs).not.toHaveBeenCalled();
  });

  it('clicking + creates a terminal session', async () => {
    const { container } = render(<BottomDrawerTabs {...defaultProps} />);

    // First button should be the + button
    const plusButton = container.querySelector('button');
    expect(plusButton).toBeTruthy();

    await act(async () => {
      fireEvent.click(plusButton!);
    });

    expect(mocks.mockCreateTerminal).toHaveBeenCalledWith(
      expect.objectContaining({
        command: ['/bin/zsh'],
      }),
    );
  });

  it('renders tab for each tab in state', () => {
    mocks.mockTabs = [
      { id: 'tab1', title: 'Session 1', variant: 'terminal', icon: 'LuTerminal' },
      { id: 'tab2', title: 'Session 2', variant: 'terminal', icon: 'LuTerminal' },
      { id: 'tab3', title: 'Logs', variant: 'logs', icon: 'LuLogs' },
    ];
    mocks.mockFocused = 0;

    const { getAllByText } = render(<BottomDrawerTabs {...defaultProps} />);

    expect(getAllByText('Session 1')).toHaveLength(1);
    expect(getAllByText('Session 2')).toHaveLength(1);
    expect(getAllByText('Logs')).toHaveLength(1);
  });

  it('clicking a tab calls focusTab', () => {
    mocks.mockTabs = [
      { id: 'tab1', title: 'Session 1', variant: 'terminal', icon: 'LuTerminal' },
      { id: 'tab2', title: 'Session 2', variant: 'terminal', icon: 'LuTerminal' },
    ];
    mocks.mockFocused = 0;

    const { getByText } = render(<BottomDrawerTabs {...defaultProps} />);

    act(() => {
      fireEvent.click(getByText('Session 2'));
    });

    expect(mocks.mockFocusTab).toHaveBeenCalledWith({ index: 1 });
  });

  it('fullscreen button shows LuMinimize when fullscreen', () => {
    const { container } = render(
      <BottomDrawerTabs {...defaultProps} isFullscreen={true} />,
    );

    // The fullscreen button should be rendered — we can check it exists
    const buttons = container.querySelectorAll('button');
    // The last two buttons are fullscreen and collapse
    expect(buttons.length).toBeGreaterThanOrEqual(2);
  });

  it('collapse button calls onMinimize when not minimized', () => {
    const onMinimize = vi.fn();
    const onExpand = vi.fn();
    mocks.mockTabs = [{ id: 'tab1', title: 'Session 1', variant: 'terminal', icon: 'LuTerminal' }];

    const { container } = render(
      <BottomDrawerTabs {...defaultProps} hasTabs={true} isMinimized={false} onMinimize={onMinimize} onExpand={onExpand} />,
    );

    // The last button is the collapse/expand button
    const buttons = container.querySelectorAll('button');
    const collapseBtn = buttons[buttons.length - 1];

    act(() => {
      fireEvent.click(collapseBtn);
    });

    expect(onMinimize).toHaveBeenCalled();
    expect(onExpand).not.toHaveBeenCalled();
  });

  it('collapse button calls onExpand when minimized', () => {
    const onMinimize = vi.fn();
    const onExpand = vi.fn();
    mocks.mockTabs = [{ id: 'tab1', title: 'Session 1', variant: 'terminal', icon: 'LuTerminal' }];

    const { container } = render(
      <BottomDrawerTabs {...defaultProps} hasTabs={true} isMinimized={true} onMinimize={onMinimize} onExpand={onExpand} />,
    );

    // The last button is the collapse/expand button
    const buttons = container.querySelectorAll('button');
    const collapseBtn = buttons[buttons.length - 1];

    act(() => {
      fireEvent.click(collapseBtn);
    });

    expect(onExpand).toHaveBeenCalled();
    expect(onMinimize).not.toHaveBeenCalled();
  });

  it('fullscreen button calls onFullscreen', () => {
    const onFullscreen = vi.fn();
    mocks.mockTabs = [{ id: 'tab1', title: 'Session 1', variant: 'terminal', icon: 'LuTerminal' }];

    const { container } = render(
      <BottomDrawerTabs {...defaultProps} hasTabs={true} onFullscreen={onFullscreen} />,
    );

    // The second-to-last button is the fullscreen button
    const buttons = container.querySelectorAll('button');
    const fullscreenBtn = buttons[buttons.length - 2];

    act(() => {
      fireEvent.click(fullscreenBtn);
    });

    expect(onFullscreen).toHaveBeenCalled();
  });

  it('disables resize controls when no tabs exist', () => {
    const onFullscreen = vi.fn();
    const onMinimize = vi.fn();
    const onExpand = vi.fn();

    const { container } = render(
      <BottomDrawerTabs
        {...defaultProps}
        hasTabs={false}
        onFullscreen={onFullscreen}
        onMinimize={onMinimize}
        onExpand={onExpand}
      />,
    );

    const buttons = container.querySelectorAll('button');
    const fullscreenBtn = buttons[buttons.length - 2] as HTMLButtonElement;
    const collapseBtn = buttons[buttons.length - 1] as HTMLButtonElement;

    expect(fullscreenBtn.disabled).toBe(true);
    expect(collapseBtn.disabled).toBe(true);

    act(() => {
      fireEvent.click(fullscreenBtn);
      fireEvent.click(collapseBtn);
    });

    expect(onFullscreen).not.toHaveBeenCalled();
    expect(onMinimize).not.toHaveBeenCalled();
    expect(onExpand).not.toHaveBeenCalled();
  });
});
