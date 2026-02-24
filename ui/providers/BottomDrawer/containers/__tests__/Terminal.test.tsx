import { render, cleanup, act } from '@testing-library/react';

// ─── xterm mocks ───────────────────────────────────────────────────────────────
const mockOpen = jest.fn();
const mockLoadAddon = jest.fn();
const mockFocus = jest.fn();
const mockDispose = jest.fn();

let onResizeCallback: ((e: { rows: number; cols: number }) => void) | null = null;
let onDataCallback: ((data: string) => void) | null = null;

const mockOnResize = jest.fn((cb) => { onResizeCallback = cb; });
const mockOnData = jest.fn((cb) => { onDataCallback = cb; });

jest.mock('@xterm/xterm', () => ({
  Terminal: jest.fn().mockImplementation((opts: any) => ({
    options: opts,
    open: mockOpen,
    loadAddon: mockLoadAddon,
    focus: mockFocus,
    dispose: mockDispose,
    onResize: mockOnResize,
    onData: mockOnData,
    write: jest.fn(),
  })),
}));

const mockFit = jest.fn();
jest.mock('@xterm/addon-fit', () => ({
  FitAddon: jest.fn().mockImplementation(() => ({
    fit: mockFit,
    dispose: jest.fn(),
  })),
}));

jest.mock('@xterm/addon-canvas', () => ({
  CanvasAddon: jest.fn().mockImplementation(() => ({ dispose: jest.fn() })),
}));

jest.mock('@xterm/addon-webgl', () => ({
  WebglAddon: jest.fn().mockImplementation(() => ({ dispose: jest.fn() })),
}));

jest.mock('@xterm/addon-web-links', () => ({
  WebLinksAddon: jest.fn().mockImplementation(() => ({ dispose: jest.fn() })),
}));

// ─── runtime mocks ─────────────────────────────────────────────────────────────
const mockEventsOn = jest.fn(() => jest.fn());
const mockEventsOff = jest.fn();

jest.mock('@omniviewdev/runtime/runtime', () => ({
  EventsOn: mockEventsOn,
  EventsOff: mockEventsOff,
}));

const mockAttachSession = jest.fn().mockResolvedValue(undefined);
const mockDetachSession = jest.fn().mockResolvedValue(undefined);
const mockResizeSession = jest.fn().mockResolvedValue(undefined);
const mockWriteSession = jest.fn().mockResolvedValue(undefined);

jest.mock('@omniviewdev/runtime/api', () => ({
  ExecClient: {
    AttachSession: (...args: any[]) => mockAttachSession(...args),
    DetachSession: (...args: any[]) => mockDetachSession(...args),
    ResizeSession: (...args: any[]) => mockResizeSession(...args),
    WriteSession: (...args: any[]) => mockWriteSession(...args),
  },
}));

jest.mock('@omniviewdev/runtime', () => ({
  useSettings: () => ({
    settings: {
      'terminal.cursorBlink': true,
      'terminal.cursorStyle': 'block',
      'terminal.fontSize': 14,
    },
  }),
}));

jest.mock('@/features/logger', () => ({
  __esModule: true,
  default: { error: jest.fn() },
}));

// Mock the event bus
const mockEmit = jest.fn();
const mockChannelOn = jest.fn((_event: any, _handler: any) => jest.fn());
jest.mock('../../events', () => ({
  bottomDrawerChannel: {
    emit: (...args: any[]) => mockEmit(...args),
    on: (event: any, handler: any) => mockChannelOn(event, handler),
  },
}));

jest.mock('@/utils/debounce', () => ({
  debounce: (fn: Function) => fn,
}));

jest.mock('js-base64', () => ({
  Base64: { toUint8Array: jest.fn((_s: string) => new Uint8Array()) },
}));

// ─── ResizeObserver spy ─────────────────────────────────────────────────────────
let resizeObserverCallback: ResizeObserverCallback | null = null;
const mockObserve = jest.fn();
const mockUnobserve = jest.fn();
const mockDisconnect = jest.fn();

beforeEach(() => {
  global.ResizeObserver = jest.fn().mockImplementation((cb: ResizeObserverCallback) => {
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
    jest.clearAllMocks();
    onResizeCallback = null;
    onDataCallback = null;
    resizeObserverCallback = null;
  });

  afterEach(() => {
    cleanup();
  });

  it('does not create a terminal when sessionId is empty', () => {
    render(<TerminalContainer sessionId="" />);

    expect(Terminal).not.toHaveBeenCalled();
    expect(mockOpen).not.toHaveBeenCalled();
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
      }),
    );
    expect(mockOpen).toHaveBeenCalled();
  });

  it('loads FitAddon, CanvasAddon, and WebglAddon', () => {
    render(<TerminalContainer sessionId="test-session-123" />);

    // FitAddon + CanvasAddon + WebglAddon + WebLinksAddon = 4
    expect(mockLoadAddon).toHaveBeenCalledTimes(4);
  });

  it('calls fitAddon.fit() after attach resolves', async () => {
    await act(async () => {
      render(<TerminalContainer sessionId="test-session-123" />);
    });

    expect(mockAttachSession).toHaveBeenCalledWith('test-session-123');
    expect(mockFit).toHaveBeenCalled();
  });

  it('sets up ResizeObserver on the container div', () => {
    render(<TerminalContainer sessionId="test-session-123" />);

    expect(global.ResizeObserver).toHaveBeenCalled();
    expect(mockObserve).toHaveBeenCalled();
  });

  it('calls ExecClient.ResizeSession on terminal.onResize', () => {
    render(<TerminalContainer sessionId="test-session-123" />);

    expect(onResizeCallback).toBeTruthy();

    act(() => {
      onResizeCallback!({ rows: 24, cols: 80 });
    });

    expect(mockResizeSession).toHaveBeenCalledWith('test-session-123', 24, 80);
  });

  it('calls ExecClient.WriteSession on terminal.onData', async () => {
    await act(async () => {
      render(<TerminalContainer sessionId="test-session-123" />);
    });

    expect(onDataCallback).toBeTruthy();

    act(() => {
      onDataCallback!('hello');
    });

    expect(mockWriteSession).toHaveBeenCalledWith('test-session-123', 'hello');
  });

  it('cleans up on unmount', async () => {
    const { unmount } = render(<TerminalContainer sessionId="test-session-123" />);

    await act(async () => {
      // Let attach resolve
      await Promise.resolve();
    });

    unmount();

    expect(mockDispose).toHaveBeenCalled();
    expect(mockDetachSession).toHaveBeenCalledWith('test-session-123');
    // Signal handlers should be cleaned up via EventsOff
    expect(mockEventsOff).toHaveBeenCalled();
  });

  it('container div has correct styles', () => {
    const { container } = render(<TerminalContainer sessionId="test-session-123" />);

    const terminalDiv = container.querySelector('div');
    expect(terminalDiv).toBeTruthy();
    expect(terminalDiv!.style.backgroundColor).toBe('black');
    expect(terminalDiv!.style.height).toBe('100%');
    expect(terminalDiv!.style.width).toBe('100%');
  });

  it('ResizeObserver callback triggers fit', () => {
    render(<TerminalContainer sessionId="test-session-123" />);

    const fitCallsBefore = mockFit.mock.calls.length;

    act(() => {
      resizeObserverCallback!([], {} as ResizeObserver);
    });

    // debounce is mocked to be immediate, so fit should have been called
    expect(mockFit.mock.calls.length).toBeGreaterThan(fitCallsBefore);
  });

  it('focuses the terminal after open', () => {
    render(<TerminalContainer sessionId="test-session-123" />);

    expect(mockFocus).toHaveBeenCalled();
  });

  it('sets up signal handlers via EventsOn', async () => {
    await act(async () => {
      render(<TerminalContainer sessionId="test-session-123" />);
    });

    // Should register stdout, stderr, and signal handlers
    const eventNames = mockEventsOn.mock.calls.map((call: any[]) => call[0]);
    expect(eventNames).toContain('core/exec/stream/stdout/test-session-123');
    expect(eventNames).toContain('core/exec/stream/stderr/test-session-123');
    expect(eventNames).toContain('core/exec/signal/CLOSE/test-session-123');
  });

  it('subscribes to onResizeReset for re-fitting after drawer transitions', () => {
    render(<TerminalContainer sessionId="test-session-123" />);

    // Should subscribe to onResizeReset via bottomDrawerChannel.on
    expect(mockChannelOn).toHaveBeenCalledWith('onResizeReset', expect.any(Function));
  });
});
