import { render, cleanup, act } from '@testing-library/react';

// ─── xterm mocks ───────────────────────────────────────────────────────────────
const mocks = vi.hoisted(() => {
  const state = {
    onResizeCallback: null as ((e: { rows: number; cols: number }) => void) | null,
    onDataCallback: null as ((data: string) => void) | null,
  };

  return {
    state,
    mockOpen: vi.fn(),
    mockLoadAddon: vi.fn(),
    mockFocus: vi.fn(),
    mockDispose: vi.fn(),
    mockOnResize: vi.fn((cb) => { state.onResizeCallback = cb; }),
    mockOnData: vi.fn((cb) => { state.onDataCallback = cb; }),
    mockFit: vi.fn(),
    mockEventsOn: vi.fn(() => vi.fn()),
    mockEventsOff: vi.fn(),
    mockAttachSession: vi.fn().mockResolvedValue(undefined),
    mockDetachSession: vi.fn().mockResolvedValue(undefined),
    mockResizeSession: vi.fn().mockResolvedValue(undefined),
    mockWriteSession: vi.fn().mockResolvedValue(undefined),
    mockEmit: vi.fn(),
    mockChannelOn: vi.fn((_event: any, _handler: any) => vi.fn()),
  };
});

vi.mock('@xterm/xterm', () => ({
  Terminal: vi.fn(function (this: any, opts: any) {
    return {
      options: opts,
      open: mocks.mockOpen,
      loadAddon: mocks.mockLoadAddon,
      focus: mocks.mockFocus,
      dispose: mocks.mockDispose,
      onResize: mocks.mockOnResize,
      onData: mocks.mockOnData,
      write: vi.fn(),
    };
  }),
}));

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: vi.fn(function (this: any) {
    return {
      fit: mocks.mockFit,
      dispose: vi.fn(),
    };
  }),
}));

vi.mock('@xterm/addon-canvas', () => ({
  CanvasAddon: vi.fn(function (this: any) { return { dispose: vi.fn() }; }),
}));

vi.mock('@xterm/addon-webgl', () => ({
  WebglAddon: vi.fn(function (this: any) { return { dispose: vi.fn() }; }),
}));

vi.mock('@xterm/addon-web-links', () => ({
  WebLinksAddon: vi.fn(function (this: any) { return { dispose: vi.fn() }; }),
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
    AttachSession: (...args: any[]) => mocks.mockAttachSession(...args),
    DetachSession: (...args: any[]) => mocks.mockDetachSession(...args),
    ResizeSession: (...args: any[]) => mocks.mockResizeSession(...args),
    WriteSession: (...args: any[]) => mocks.mockWriteSession(...args),
  },
}));

vi.mock('@omniviewdev/runtime', () => ({
  useSettings: () => ({
    settings: {
      'terminal.cursorBlink': true,
      'terminal.cursorStyle': 'block',
      'terminal.fontSize': 14,
      'terminal.theme': 'default',
    },
  }),
}));

vi.mock('@/features/logger', () => ({
  __esModule: true,
  default: { error: vi.fn() },
}));

// Mock the event bus
vi.mock('../../events', () => ({
  bottomDrawerChannel: {
    emit: (...args: any[]) => mocks.mockEmit(...args),
    on: (event: any, handler: any) => mocks.mockChannelOn(event, handler),
  },
}));

vi.mock('@/utils/debounce', () => ({
  debounce: (fn: Function) => fn,
}));

vi.mock('js-base64', () => ({
  Base64: { toUint8Array: vi.fn((_s: string) => new Uint8Array()) },
}));

// ─── ResizeObserver spy ─────────────────────────────────────────────────────────
let resizeObserverCallback: ResizeObserverCallback | null = null;
const mockObserve = vi.fn();
const mockUnobserve = vi.fn();
const mockDisconnect = vi.fn();

beforeEach(() => {
  global.ResizeObserver = vi.fn(function (this: any, cb: ResizeObserverCallback) {
    resizeObserverCallback = cb;
    return {
      observe: mockObserve,
      unobserve: mockUnobserve,
      disconnect: mockDisconnect,
    };
  }) as any;
});

// ─── Import after mocks ────────────────────────────────────────────────────────
import TerminalContainer from '../Terminal';
import { Terminal } from '@xterm/xterm';

describe('TerminalContainer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.state.onResizeCallback = null;
    mocks.state.onDataCallback = null;
    resizeObserverCallback = null;
  });

  afterEach(() => {
    cleanup();
  });

  it('does not create a terminal when sessionId is empty', () => {
    render(<TerminalContainer sessionId="" />);

    expect(Terminal).not.toHaveBeenCalled();
    expect(mocks.mockOpen).not.toHaveBeenCalled();
  });

  it('mounts and creates terminal with correct options', () => {
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
          background: '#1e1e1e',
          foreground: '#d4d4d4',
        }),
      }),
    );
    expect(mocks.mockOpen).toHaveBeenCalled();
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

  it('container div has correct styles', () => {
    const { container } = render(<TerminalContainer sessionId="test-session-123" />);

    // The outer div is position:relative wrapper, the inner div has the terminal bg
    const divs = container.querySelectorAll('div');
    const terminalDiv = divs[1]; // inner div with ref + background
    expect(terminalDiv).toBeTruthy();
    expect(terminalDiv!.style.backgroundColor).toBe('rgb(30, 30, 30)');
    expect(terminalDiv!.style.height).toBe('100%');
    expect(terminalDiv!.style.width).toBe('100%');
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
    const eventNames = mocks.mockEventsOn.mock.calls.map((call: any[]) => call[0]);
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
