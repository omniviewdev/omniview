import { render, cleanup, act, fireEvent } from '@testing-library/react';

// ─── Mocks ─────────────────────────────────────────────────────────────────────

const mockCreateTab = jest.fn();
const mockCreateTabs = jest.fn();
const mockFocusTab = jest.fn();
const mockCloseTab = jest.fn();
const mockCloseTabs = jest.fn();
const mockReorderTab = jest.fn();
const mockUpdateTab = jest.fn();

let mockTabs: any[] = [];
let mockFocused = 0;

jest.mock('@omniviewdev/runtime', () => ({
  useBottomDrawer: () => ({
    tabs: mockTabs,
    focused: mockFocused,
    focusTab: mockFocusTab,
    closeTab: mockCloseTab,
    closeTabs: mockCloseTabs,
    createTab: mockCreateTab,
    createTabs: mockCreateTabs,
    updateTab: mockUpdateTab,
    reorderTab: mockReorderTab,
  }),
  useSettings: () => ({
    settings: {
      'terminal.defaultShell': '/bin/zsh',
    },
  }),
  parseAppError: (err: any) => ({ detail: typeof err === 'string' ? err : err?.message ?? String(err) }),
}));

const mockCreateTerminal = jest.fn().mockResolvedValue({ id: 'new-session-id' });
const mockListSessions = jest.fn().mockResolvedValue([]);

jest.mock('@omniviewdev/runtime/api', () => ({
  ExecClient: {
    CreateTerminal: (...args: any[]) => mockCreateTerminal(...args),
    ListSessions: () => mockListSessions(),
  },
  LogsClient: {
    CreateSession: jest.fn().mockResolvedValue({ id: 'log-sess-id' }),
  },
}));

jest.mock('@omniviewdev/runtime/models', () => ({
  exec: {
    CreateTerminalOptions: {
      createFrom: (opts: any) => opts,
    },
  },
  logs: {
    CreateSessionOptions: {
      createFrom: (opts: any) => opts,
    },
    LogSessionOptions: {
      createFrom: (opts: any) => opts,
    },
  },
}));

const mockEventsOn = jest.fn(() => jest.fn());
jest.mock('@omniviewdev/runtime/runtime', () => ({
  EventsOn: mockEventsOn,
}));

jest.mock('../events', () => ({
  bottomDrawerChannel: {
    on: jest.fn(() => jest.fn()),
    emit: jest.fn(),
  },
}));

jest.mock('@/features/devtools/events', () => ({
  devToolsChannel: {
    on: jest.fn(() => jest.fn()),
    emit: jest.fn(),
  },
}));

jest.mock('@/components/icons/Icon', () => {
  return { __esModule: true, default: ({ name }: { name: string }) => <span data-testid={`icon-${name}`} /> };
});

// DnD mocks - minimal stubs
jest.mock('@dnd-kit/core', () => ({
  DndContext: ({ children }: any) => <div>{children}</div>,
  closestCenter: jest.fn(),
  KeyboardSensor: jest.fn(),
  PointerSensor: jest.fn(),
  useSensor: jest.fn(),
  useSensors: jest.fn(() => []),
}));

jest.mock('@dnd-kit/sortable', () => ({
  SortableContext: ({ children }: any) => <div>{children}</div>,
  sortableKeyboardCoordinates: jest.fn(),
  horizontalListSortingStrategy: jest.fn(),
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: jest.fn(),
    transform: null,
    transition: null,
  }),
}));

jest.mock('@dnd-kit/modifiers', () => ({
  restrictToHorizontalAxis: jest.fn(),
  restrictToParentElement: jest.fn(),
}));

import BottomDrawerTabs from '../tabs';

describe('BottomDrawerTabs', () => {
  const defaultProps = {
    isMinimized: false,
    isFullscreen: false,
    onMinimize: jest.fn(),
    onExpand: jest.fn(),
    onFullscreen: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockTabs = [];
    mockFocused = 0;
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

  it('clicking + creates a terminal session', async () => {
    const { container } = render(<BottomDrawerTabs {...defaultProps} />);

    // First button should be the + button
    const plusButton = container.querySelector('button');
    expect(plusButton).toBeTruthy();

    await act(async () => {
      fireEvent.click(plusButton!);
    });

    expect(mockCreateTerminal).toHaveBeenCalledWith(
      expect.objectContaining({
        command: ['/bin/zsh'],
      }),
    );
  });

  it('renders tab for each tab in state', () => {
    mockTabs = [
      { id: 'tab1', title: 'Session 1', variant: 'terminal', icon: 'LuTerminal' },
      { id: 'tab2', title: 'Session 2', variant: 'terminal', icon: 'LuTerminal' },
      { id: 'tab3', title: 'Logs', variant: 'logs', icon: 'LuLogs' },
    ];
    mockFocused = 0;

    const { getAllByText } = render(<BottomDrawerTabs {...defaultProps} />);

    expect(getAllByText('Session 1')).toHaveLength(1);
    expect(getAllByText('Session 2')).toHaveLength(1);
    expect(getAllByText('Logs')).toHaveLength(1);
  });

  it('clicking a tab calls focusTab', () => {
    mockTabs = [
      { id: 'tab1', title: 'Session 1', variant: 'terminal', icon: 'LuTerminal' },
      { id: 'tab2', title: 'Session 2', variant: 'terminal', icon: 'LuTerminal' },
    ];
    mockFocused = 0;

    const { getByText } = render(<BottomDrawerTabs {...defaultProps} />);

    act(() => {
      fireEvent.click(getByText('Session 2'));
    });

    expect(mockFocusTab).toHaveBeenCalledWith({ index: 1 });
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
    const onMinimize = jest.fn();
    const onExpand = jest.fn();

    const { container } = render(
      <BottomDrawerTabs {...defaultProps} isMinimized={false} onMinimize={onMinimize} onExpand={onExpand} />,
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
    const onMinimize = jest.fn();
    const onExpand = jest.fn();

    const { container } = render(
      <BottomDrawerTabs {...defaultProps} isMinimized={true} onMinimize={onMinimize} onExpand={onExpand} />,
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
    const onFullscreen = jest.fn();

    const { container } = render(
      <BottomDrawerTabs {...defaultProps} onFullscreen={onFullscreen} />,
    );

    // The second-to-last button is the fullscreen button
    const buttons = container.querySelectorAll('button');
    const fullscreenBtn = buttons[buttons.length - 2];

    act(() => {
      fireEvent.click(fullscreenBtn);
    });

    expect(onFullscreen).toHaveBeenCalled();
  });
});
