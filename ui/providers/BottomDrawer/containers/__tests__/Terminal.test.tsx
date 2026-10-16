import {
  useLayoutEffect,
  useRef,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
} from 'react';
import { render, cleanup, act, screen, waitFor } from '@testing-library/react';
import type { BottomDrawerTab } from '@omniviewdev/runtime';

// ─── xterm mocks ───────────────────────────────────────────────────────────────
const mocks = vi.hoisted(() => {
  const state = {
    onResizeCallback: null as ((e: { rows: number; cols: number }) => void) | null,
    onDataCallback: null as ((data: string) => void) | null,
    terminal: null as { options: Record<string, unknown> } | null,
    applicationTheme: {
      background: '#102030',
      foreground: '#f0e0d0',
      cursor: '#f0e0d0',
    },
    activeTheme: { id: 'void' },
  };
  const settings: Record<string, unknown> = {
    'terminal.cursorBlink': true,
    'terminal.cursorStyle': 'block',
    'terminal.fontSize': 14,
    'terminal.theme': 'application',
  };


  return {
    state,
    settings,
    mockBuildXtermTheme: vi.fn((element?: HTMLElement | null) => {
      const scope = element?.closest('[data-terminal-theme-scope]');
      return {
        background: scope?.getAttribute('data-terminal-background') ?? state.applicationTheme.background,
        foreground: scope?.getAttribute('data-terminal-foreground') ?? state.applicationTheme.foreground,
        cursor: scope?.getAttribute('data-terminal-foreground') ?? state.applicationTheme.cursor,
      };
    }),
    mockOpen: vi.fn(),
    mockLoadAddon: vi.fn(),
    mockFocus: vi.fn(),
    mockDispose: vi.fn(),
    mockOnResize: vi.fn((cb) => {
      state.onResizeCallback = cb; 
    }),
    mockOnData: vi.fn((cb) => {
      state.onDataCallback = cb; 
    }),
    mockFit: vi.fn(),
    mockEventsOn: vi.fn(() => vi.fn()),
    mockEventsOff: vi.fn(),
    mockAttachSession: vi.fn().mockResolvedValue([undefined, undefined]),
    mockDetachSession: vi.fn().mockResolvedValue(undefined),
    mockResizeSession: vi.fn().mockResolvedValue(undefined),
    mockWriteSession: vi.fn().mockResolvedValue(undefined),
    mockEmit: vi.fn(),
    mockChannelOn: vi.fn((_event: unknown, _handler: unknown) => vi.fn()),
  };
});

vi.mock('@xterm/xterm', () => ({
  Terminal: vi.fn(function (this: unknown, opts: Record<string, unknown>) {
    const terminal = {
      options: opts,
      open: mocks.mockOpen,
      loadAddon: mocks.mockLoadAddon,
      focus: mocks.mockFocus,
      dispose: mocks.mockDispose,
      onResize: mocks.mockOnResize,
      onData: mocks.mockOnData,
      write: vi.fn(),
    };
    mocks.state.terminal = terminal;
    return terminal;
  }),
}));

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: vi.fn(function (this: unknown) {
    return {
      fit: mocks.mockFit,
      dispose: vi.fn(),
    };
  }),
}));

vi.mock('@xterm/addon-canvas', () => ({
  CanvasAddon: vi.fn(function (this: unknown) {
    return { dispose: vi.fn() }; 
  }),
}));

vi.mock('@xterm/addon-webgl', () => ({
  WebglAddon: vi.fn(function (this: unknown) {
    return { dispose: vi.fn() }; 
  }),
}));

vi.mock('@xterm/addon-web-links', () => ({
  WebLinksAddon: vi.fn(function (this: unknown) {
    return { dispose: vi.fn() }; 
  }),
}));

// ─── runtime mocks ─────────────────────────────────────────────────────────────
vi.mock('@omniviewdev/runtime/runtime', () => ({
  Events: {
    On: mocks.mockEventsOn,
    Off: mocks.mockEventsOff,
  },
}));

vi.mock('@omniviewdev/runtime/api', () => ({
  ExecClient: {
    AttachSession: mocks.mockAttachSession,
    DetachSession: mocks.mockDetachSession,
    ResizeSession: mocks.mockResizeSession,
    WriteSession: mocks.mockWriteSession,
  },
}));

vi.mock('@omniviewdev/base-ui', () => ({
  useTheme: () => ({ activeTheme: mocks.state.activeTheme }),
  Spinner: () => <div role="status" />,
  Button: (props: ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props} />,
  Text: (props: HTMLAttributes<HTMLSpanElement>) => <span {...props} />,
}));

vi.mock('@omniviewdev/editors', () => ({
  buildXtermTheme: (element?: HTMLElement | null) => mocks.mockBuildXtermTheme(element),
}));

vi.mock('@omniviewdev/runtime', () => ({
  useSettings: () => ({
    settings: mocks.settings,
  }),
  parseAppError: () => ({ detail: 'test error' }),
}));

vi.mock('@/features/logger', () => ({
  __esModule: true,
  default: { error: vi.fn() },
}));

// Mock the event bus
vi.mock('../../events', () => ({
  bottomDrawerChannel: {
    emit: mocks.mockEmit,
    on: mocks.mockChannelOn,
  },
}));

vi.mock('@/utils/debounce', () => ({
  debounce: <T,>(fn: T) => fn,
}));

vi.mock('js-base64', () => ({
  Base64: {
    toUint8Array: vi.fn((_s: string) => new Uint8Array()),
    encode: vi.fn((value: string) => value),
  },
}));

// ─── ResizeObserver spy ─────────────────────────────────────────────────────────
let resizeObserverCallback: ResizeObserverCallback | null = null;
const mockObserve = vi.fn();
const mockUnobserve = vi.fn();
const mockDisconnect = vi.fn();

beforeEach(() => {
  global.ResizeObserver = vi.fn(function (this: unknown, cb: ResizeObserverCallback) {
    resizeObserverCallback = cb;
    return {
      observe: mockObserve,
      unobserve: mockUnobserve,
      disconnect: mockDisconnect,
    };
  }) as unknown as typeof ResizeObserver;
});

// ─── Import after mocks ────────────────────────────────────────────────────────
import TerminalContainer from '../Terminal';
import { Terminal } from '@xterm/xterm';

function ScopedThemeHarness({
  background,
  foreground,
  revision,
  sessionId = 'scoped-session',
}: {
  background: string;
  foreground: string;
  revision: string;
  sessionId?: string;
}) {
  const scopeRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    scopeRef.current?.setAttribute('data-terminal-background', background);
    scopeRef.current?.setAttribute('data-terminal-foreground', foreground);
  }, [background, foreground]);

  return (
    <div
      ref={scopeRef}
      data-testid="terminal-theme-scope"
      data-terminal-theme-scope
      data-terminal-background="#render-stale"
      data-terminal-foreground="#render-stale"
    >
      <TerminalContainer
        sessionId={sessionId}
        tab={{ title: revision, properties: {} } as unknown as BottomDrawerTab}
      />
    </div>
  );
}

describe('TerminalContainer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.state.onResizeCallback = null;
    mocks.state.onDataCallback = null;
    resizeObserverCallback = null;
    mocks.state.terminal = null;
    mocks.state.activeTheme = { id: 'void' };
    mocks.state.applicationTheme = {
      background: '#102030',
      foreground: '#f0e0d0',
      cursor: '#f0e0d0',
    };
    mocks.settings = {
      'terminal.cursorBlink': true,
      'terminal.cursorStyle': 'block',
      'terminal.fontSize': 14,
      'terminal.theme': 'application',
    };
  });

  afterEach(() => {
    cleanup();
  });

  it('does not create a terminal when sessionId is empty', () => {
    render(<TerminalContainer sessionId="" />);

    expect(Terminal).not.toHaveBeenCalled();
    expect(mocks.mockOpen).not.toHaveBeenCalled();
  });

  it('uses the application background while a session is connecting', () => {
    // This is the minimal controlled fixture consumed by TerminalContainer.
    const tab = { properties: { status: 'connecting' } } as unknown as BottomDrawerTab;
    const { container } = render(<TerminalContainer sessionId="test-session-123" tab={tab} />);

    expect(screen.getByText('Connecting...')).toBeInTheDocument();
    expect((container.firstElementChild as HTMLElement).style.backgroundColor).toBe('rgb(16, 32, 48)');
    expect(Terminal).not.toHaveBeenCalled();
  });

  it('uses the application background for session creation errors', () => {
    // This is the minimal controlled fixture consumed by TerminalContainer.
    const tab = {
      properties: { status: 'error', error: 'permission denied' },
    } as unknown as BottomDrawerTab;
    const { container } = render(<TerminalContainer sessionId="test-session-123" tab={tab} />);

    expect(screen.getByText('Connection Failed')).toBeInTheDocument();
    expect(screen.getByText('permission denied')).toBeInTheDocument();
    expect((container.firstElementChild as HTMLElement).style.backgroundColor).toBe('rgb(16, 32, 48)');
    expect(Terminal).not.toHaveBeenCalled();
  });

  it('mounts with the resolved application theme', () => {
    render(<TerminalContainer sessionId="test-session-123" />);

    expect(Terminal).toHaveBeenCalledWith(
      expect.objectContaining({
        cursorBlink: true,
        cursorStyle: 'block',
        allowProposedApi: true,
        allowTransparency: true,
        macOptionIsMeta: true,
        macOptionClickForcesSelection: true,
        fontSize: 14,
        fontFamily: expect.stringContaining('Consolas'),
        theme: expect.objectContaining({
          background: '#102030',
          foreground: '#f0e0d0',
        }),
      }),
    );
    expect(mocks.mockBuildXtermTheme).toHaveBeenCalledWith(expect.any(HTMLElement));
    expect(mocks.mockOpen).toHaveBeenCalled();
  });

  it('updates a live application-themed terminal when application tokens change', () => {
    const view = render(<TerminalContainer sessionId="test-session-123" />);

    mocks.state.applicationTheme = {
      background: '#304050',
      foreground: '#ffffff',
      cursor: '#ffffff',
    };
    mocks.state.activeTheme = { id: 'plugin:acme/slate' };
    view.rerender(<TerminalContainer sessionId="test-session-123" />);

    expect(mocks.state.terminal?.options.theme).toEqual(expect.objectContaining({
      background: '#304050',
      foreground: '#ffffff',
    }));
  });

  it('resolves scoped application tokens after the theme commit and updates shared chrome', async () => {
    const view = render(
      <ScopedThemeHarness
        background="#123456"
        foreground="#fefefe"
        revision="void"
      />,
    );
    const scope = screen.getByTestId('terminal-theme-scope');
    const terminalElement = scope.firstElementChild?.firstElementChild as HTMLElement;

    await waitFor(() => {
      expect(terminalElement.style.backgroundColor).toBe('rgb(18, 52, 86)');
    });
    expect(mocks.state.terminal?.options.theme).toEqual(expect.objectContaining({
      background: '#123456',
      foreground: '#fefefe',
    }));

    mocks.state.activeTheme = { id: 'plugin:acme/scoped' };
    view.rerender(
      <ScopedThemeHarness
        background="#654321"
        foreground="#eeeeee"
        revision="plugin:acme/scoped"
      />,
    );

    await waitFor(() => {
      expect(mocks.mockBuildXtermTheme).toHaveLastReturnedWith(expect.objectContaining({
        background: '#654321',
      }));
    });

    await waitFor(() => {
      expect(terminalElement.style.backgroundColor).toBe('rgb(101, 67, 33)');
    });
    expect(mocks.state.terminal?.options.theme).toEqual(expect.objectContaining({
      background: '#654321',
      foreground: '#eeeeee',
    }));
    expect(Terminal).toHaveBeenCalledTimes(1);
  });

  it('re-resolves a same-ID replacement without recreating the terminal', async () => {
    mocks.state.activeTheme = { id: 'plugin:acme/scoped' };
    const view = render(
      <ScopedThemeHarness
        background="#123456"
        foreground="#fefefe"
        revision="first registration"
      />,
    );
    const scope = screen.getByTestId('terminal-theme-scope');
    const terminalElement = scope.firstElementChild?.firstElementChild as HTMLElement;

    await waitFor(() => {
      expect(terminalElement.style.backgroundColor).toBe('rgb(18, 52, 86)');
    });

    mocks.state.activeTheme = { id: 'plugin:acme/scoped' };
    view.rerender(
      <ScopedThemeHarness
        background="#654321"
        foreground="#eeeeee"
        revision="replacement registration"
      />,
    );

    await waitFor(() => {
      expect(mocks.mockBuildXtermTheme).toHaveLastReturnedWith(expect.objectContaining({
        background: '#654321',
        foreground: '#eeeeee',
      }));
    });
    await waitFor(() => {
      expect(terminalElement.style.backgroundColor).toBe('rgb(101, 67, 33)');
    });
    expect(mocks.state.terminal?.options.theme).toEqual(expect.objectContaining({
      background: '#654321',
      foreground: '#eeeeee',
    }));
    expect(Terminal).toHaveBeenCalledTimes(1);
  });

  it('preserves an explicit terminal override during live application theme changes', () => {
    mocks.settings = { ...mocks.settings, 'terminal.theme': 'dracula' };
    const view = render(<TerminalContainer sessionId="test-session-123" />);

    expect(mocks.state.terminal?.options.theme).toEqual(expect.objectContaining({
      background: '#282a36',
      foreground: '#f8f8f2',
    }));

    mocks.state.applicationTheme = {
      background: '#304050',
      foreground: '#ffffff',
      cursor: '#ffffff',
    };
    mocks.state.activeTheme = { id: 'plugin:acme/slate' };
    view.rerender(<TerminalContainer sessionId="test-session-123" />);

    expect(mocks.state.terminal?.options.theme).toEqual(expect.objectContaining({
      background: '#282a36',
      foreground: '#f8f8f2',
    }));
  });

  it('resolves the current application theme again when reconnecting', () => {
    const view = render(<TerminalContainer sessionId="first-session" />);

    mocks.state.applicationTheme = {
      background: '#405060',
      foreground: '#ffffff',
      cursor: '#ffffff',
    };
    mocks.state.activeTheme = { id: 'plugin:acme/reconnected' };
    view.rerender(<TerminalContainer sessionId="second-session" />);

    expect(Terminal).toHaveBeenCalledTimes(2);
    expect(Terminal).toHaveBeenLastCalledWith(expect.objectContaining({
      theme: expect.objectContaining({
        background: '#405060',
        foreground: '#ffffff',
      }),
    }));
  });

  it('loads FitAddon, CanvasAddon, and WebglAddon', () => {
    render(<TerminalContainer sessionId="test-session-123" />);

    // FitAddon + CanvasAddon + WebglAddon + WebLinksAddon = 4
    expect(mocks.mockLoadAddon).toHaveBeenCalledTimes(4);
  });

  it('calls fitAddon.fit() after attach resolves', async () => {
    await act(async () => {
      render(<TerminalContainer sessionId="test-session-123" />);
    });

    expect(mocks.mockAttachSession).toHaveBeenCalledWith('test-session-123');
    expect(mocks.mockFit).toHaveBeenCalled();
  });

  it('sets up ResizeObserver on the container div', () => {
    render(<TerminalContainer sessionId="test-session-123" />);

    expect(global.ResizeObserver).toHaveBeenCalled();
    expect(mockObserve).toHaveBeenCalled();
  });

  it('calls ExecClient.ResizeSession on terminal.onResize', () => {
    render(<TerminalContainer sessionId="test-session-123" />);

    expect(mocks.state.onResizeCallback).toBeTruthy();

    act(() => {
      mocks.state.onResizeCallback!({ rows: 24, cols: 80 });
    });

    expect(mocks.mockResizeSession).toHaveBeenCalledWith('test-session-123', 24, 80);
  });

  it('calls ExecClient.WriteSession on terminal.onData', async () => {
    await act(async () => {
      render(<TerminalContainer sessionId="test-session-123" />);
    });

    expect(mocks.state.onDataCallback).toBeTruthy();

    act(() => {
      mocks.state.onDataCallback!('hello');
    });

    expect(mocks.mockWriteSession).toHaveBeenCalledWith('test-session-123', 'hello');
  });

  it('cleans up on unmount', async () => {
    const { unmount } = render(<TerminalContainer sessionId="test-session-123" />);

    await act(async () => {
      // Let attach resolve
      await Promise.resolve();
    });

    unmount();

    expect(mocks.mockDispose).toHaveBeenCalled();
    expect(mocks.mockDetachSession).toHaveBeenCalledWith('test-session-123');
    // Signal handlers should be cleaned up via EventsOff
    expect(mocks.mockEventsOff).toHaveBeenCalled();
  });

  it('uses the application background for the terminal container', () => {
    const { container } = render(<TerminalContainer sessionId="test-session-123" />);

    // The outer div is position:relative wrapper, the inner div has the terminal bg
    const divs = container.querySelectorAll('div');
    const terminalDiv = divs[1]; // inner div with ref + background
    expect(terminalDiv).toBeTruthy();
    expect(terminalDiv.style.backgroundColor).toBe('rgb(16, 32, 48)');
    expect(terminalDiv.style.height).toBe('100%');
    expect(terminalDiv.style.width).toBe('100%');
  });

  it('ResizeObserver callback triggers fit', () => {
    render(<TerminalContainer sessionId="test-session-123" />);

    const fitCallsBefore = mocks.mockFit.mock.calls.length;

    act(() => {
      resizeObserverCallback!([], {} as ResizeObserver);
    });

    // debounce is mocked to be immediate, so fit should have been called
    expect(mocks.mockFit.mock.calls.length).toBeGreaterThan(fitCallsBefore);
  });

  it('focuses the terminal after open', () => {
    render(<TerminalContainer sessionId="test-session-123" />);

    expect(mocks.mockFocus).toHaveBeenCalled();
  });

  it('sets up signal handlers via EventsOn', async () => {
    await act(async () => {
      render(<TerminalContainer sessionId="test-session-123" />);
    });

    // Should register stdout, stderr, and signal handlers
    const eventNames = mocks.mockEventsOn.mock.calls.map((call: unknown[]) => call[0]);
    expect(eventNames).toContain('core/exec/stream/stdout/test-session-123');
    expect(eventNames).toContain('core/exec/stream/stderr/test-session-123');
    expect(eventNames).toContain('core/exec/signal/CLOSE/test-session-123');
  });

  it('subscribes to onResizeReset for re-fitting after drawer transitions', () => {
    render(<TerminalContainer sessionId="test-session-123" />);

    // Should subscribe to onResizeReset via bottomDrawerChannel.on
    expect(mocks.mockChannelOn).toHaveBeenCalledWith('onResizeReset', expect.any(Function));
  });
});
