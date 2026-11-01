import {
  useLayoutEffect,
  useRef,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
} from 'react';
import { render, cleanup, act, fireEvent, screen, waitFor } from '@testing-library/react';
import type { BottomDrawerTab } from '@omniviewdev/runtime';
import settingsReducer, { resetSettingValue, setSettingValue } from '@/store/settings/slice';

// ─── xterm mocks ───────────────────────────────────────────────────────────────
const mocks = vi.hoisted(() => {
  const state = {
    onResizeCallback: null as ((e: { rows: number; cols: number }) => void) | null,
    onDataCallback: null as ((data: string) => void) | null,
    terminal: null as { options: Record<string, unknown>; rows: number; cols: number } | null,
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
    mockWebglDispose: vi.fn(),
    mockWebglContextLoss: vi.fn<(callback: () => void) => void>(),
    mockFocus: vi.fn(),
    mockDispose: vi.fn(),
    mockOnResize: vi.fn((cb) => {
      state.onResizeCallback = cb; 
    }),
    mockOnData: vi.fn((cb) => {
      state.onDataCallback = cb; 
    }),
    mockFit: vi.fn(),
    mockEventsOn: vi.fn((_name: string, _handler: (event: { data: unknown }) => void) => vi.fn()),
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
      rows: 24,
      cols: 80,
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

vi.mock('@xterm/addon-webgl', () => ({
  WebglAddon: vi.fn(function (this: unknown) {
    return {
      dispose: mocks.mockWebglDispose,
      onContextLoss: mocks.mockWebglContextLoss,
    };
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



// ─── ResizeObserver spy ─────────────────────────────────────────────────────────
let resizeObserverCallback: ResizeObserverCallback | null = null;
const mockObserve = vi.fn();
const mockUnobserve = vi.fn();
const mockDisconnect = vi.fn();
const frames = new Map<number, FrameRequestCallback>();
let nextFrame = 0;
let containerWidth = 800;
let containerHeight = 400;

function flushFits() {
  const pending = [...frames.values()];
  frames.clear();
  pending.forEach(callback => {
    callback(0);
  });
}

beforeEach(() => {
  frames.clear();
  containerWidth = 800;
  containerHeight = 400;
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => containerWidth);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(() => containerHeight);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    const id = ++nextFrame;
    frames.set(id, callback);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  global.ResizeObserver = vi.fn(function (this: unknown, cb: ResizeObserverCallback) {
    resizeObserverCallback = cb;
    return {
      observe: mockObserve,
      unobserve: mockUnobserve,
      disconnect: mockDisconnect,
    };
  });
});

// ─── Import after mocks ────────────────────────────────────────────────────────
import TerminalContainer from '../Terminal';
import { Terminal } from '@xterm/xterm';
import { WebglAddon } from '@xterm/addon-webgl';

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
        tab={{
          id: sessionId,
          title: revision,
          variant: 'terminal',
          createdAt: new Date(0),
          updatedAt: new Date(0),
          properties: {},
        }}
      />
    </div>
  );
}

describe('TerminalContainer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mockLoadAddon.mockReset();
    mocks.mockFit.mockReset();
    mocks.mockResizeSession.mockReset().mockResolvedValue(undefined);
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
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('does not create a terminal when sessionId is empty', () => {
    render(<TerminalContainer sessionId="" />);

    expect(Terminal).not.toHaveBeenCalled();
    expect(mocks.mockOpen).not.toHaveBeenCalled();
  });

  it('shows connecting status without creating a terminal', () => {
    // This is the minimal controlled fixture consumed by TerminalContainer.
    const tab = { properties: { status: 'connecting' } } as unknown as BottomDrawerTab;
    render(<TerminalContainer sessionId="test-session-123" tab={tab} />);

    expect(screen.getByText('Connecting...')).toBeInTheDocument();
    expect(Terminal).not.toHaveBeenCalled();
  });

  it('shows session creation errors without creating a terminal', () => {
    // This is the minimal controlled fixture consumed by TerminalContainer.
    const tab = {
      properties: { status: 'error', error: 'permission denied' },
    } as unknown as BottomDrawerTab;
    render(<TerminalContainer sessionId="test-session-123" tab={tab} />);

    expect(screen.getByText('Connection Failed')).toBeInTheDocument();
    expect(screen.getByText('permission denied')).toBeInTheDocument();
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

  it('initializes terminal settings at 12px and resets saved sizes to 12px', () => {
    const initial = settingsReducer(undefined, { type: 'init' });
    expect(initial.core.sections.terminal.settings.fontSize.value).toBe(12);
    expect(initial.core.sections.terminal.settings.defaultShell.value).toBe('');

    const saved = settingsReducer(initial, setSettingValue({
      identifier: 'core.terminal.fontSize',
      value: 18,
    }));
    expect(saved.core.sections.terminal.settings.fontSize.value).toBe(18);

    const reset = settingsReducer(saved, resetSettingValue({
      identifier: 'core.terminal.fontSize',
    }));
    expect(reset.core.sections.terminal.settings.fontSize.value).toBe(12);
  });

  it('uses 12px until settings hydrate and retains the saved font size', () => {
    mocks.settings = {};
    const view = render(<TerminalContainer sessionId="test-session-123" />);
    const terminal = mocks.state.terminal;
    expect(terminal?.options.fontSize).toBe(12);

    mocks.settings = { 'terminal.fontSize': 18 };
    view.rerender(<TerminalContainer sessionId="test-session-123" />);

    expect(mocks.state.terminal).toBe(terminal);
    expect(terminal?.options.fontSize).toBe(18);
    expect(Terminal).toHaveBeenCalledTimes(1);
  });

  it('applies live font edits and reset without replacing the session', () => {
    const view = render(<TerminalContainer sessionId="test-session-123" />);
    const terminal = mocks.state.terminal;
    mocks.settings = { ...mocks.settings, 'terminal.fontSize': 20 };
    view.rerender(<TerminalContainer sessionId="test-session-123" />);
    expect(terminal?.options.fontSize).toBe(20);

    mocks.settings = { ...mocks.settings, 'terminal.fontSize': 12 };
    view.rerender(<TerminalContainer sessionId="test-session-123" />);
    expect(terminal?.options.fontSize).toBe(12);
    expect(mocks.state.terminal).toBe(terminal);
    expect(Terminal).toHaveBeenCalledTimes(1);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'falls back to 12px for invalid font size %s',
    (fontSize) => {
      mocks.settings = { ...mocks.settings, 'terminal.fontSize': fontSize };
      render(<TerminalContainer sessionId="test-session-123" />);
      expect(mocks.state.terminal?.options.fontSize).toBe(12);
    },
  );

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

  it('resolves scoped application tokens after the theme commit', async () => {
    const view = render(
      <ScopedThemeHarness
        background="#123456"
        foreground="#fefefe"
        revision="void"
      />,
    );

    await waitFor(() => {
      expect(mocks.state.terminal?.options.theme).toEqual(expect.objectContaining({
        background: '#123456',
        foreground: '#fefefe',
      }));
    });

    mocks.state.activeTheme = { id: 'plugin:acme/scoped' };
    view.rerender(
      <ScopedThemeHarness
        background="#654321"
        foreground="#eeeeee"
        revision="plugin:acme/scoped"
      />,
    );

    await waitFor(() => {
      expect(mocks.state.terminal?.options.theme).toEqual(expect.objectContaining({
        background: '#654321',
        foreground: '#eeeeee',
      }));
    });
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

    await waitFor(() => {
      expect(mocks.state.terminal?.options.theme).toEqual(expect.objectContaining({
        background: '#123456',
        foreground: '#fefefe',
      }));
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
      expect(mocks.state.terminal?.options.theme).toEqual(expect.objectContaining({
        background: '#654321',
        foreground: '#eeeeee',
      }));
    });
    expect(Terminal).toHaveBeenCalledTimes(1);
    expect(mocks.mockAttachSession).toHaveBeenCalledTimes(1);
    expect(mocks.mockDispose).not.toHaveBeenCalled();
    expect(mocks.mockDetachSession).not.toHaveBeenCalled();
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

  it('keeps session input and fitting usable when WebGL activation fails', async () => {
    mocks.mockLoadAddon.mockImplementation((addon) => {
      if (addon.dispose === mocks.mockWebglDispose) {
        throw new Error('WebGL unavailable');
      }
    });

    await act(async () => {
      render(<TerminalContainer sessionId="test-session-123" />);
    });

    expect(mocks.mockWebglDispose).toHaveBeenCalledOnce();
    expect(mocks.mockFocus).toHaveBeenCalled();
    expect(mocks.mockAttachSession).toHaveBeenCalledWith('test-session-123');
    expect(mocks.mockFit).toHaveBeenCalled();
    await act(async () => {
      mocks.state.onDataCallback!('ls\r');
      resizeObserverCallback!([], {} as ResizeObserver);
      flushFits();
    });
    expect(mocks.mockWriteSession).toHaveBeenCalledWith('test-session-123', 'bHMN');
  });

  it('attaches the session when WebGL construction fails', async () => {
    vi.mocked(WebglAddon).mockImplementationOnce(function () {
      throw new Error('WebGL unavailable');
    });

    await act(async () => {
      render(<TerminalContainer sessionId="test-session-123" />);
    });

    expect(mocks.mockAttachSession).toHaveBeenCalledWith('test-session-123');
    expect(mocks.mockFocus).toHaveBeenCalled();
  });

  it('restores the built-in renderer after WebGL context loss without closing the session', async () => {
    await act(async () => {
      render(<TerminalContainer sessionId="test-session-123" />);
    });

    const onContextLoss = mocks.mockWebglContextLoss.mock.calls[0][0];
    act(() => {
      onContextLoss();
    });

    expect(mocks.mockWebglDispose).toHaveBeenCalledOnce();
    expect(mocks.mockDispose).not.toHaveBeenCalled();
    expect(mocks.mockDetachSession).not.toHaveBeenCalled();
    await act(async () => {
      mocks.state.onDataCallback!('ls\r');
      resizeObserverCallback!([], {} as ResizeObserver);
      flushFits();
    });
    expect(mocks.mockWriteSession).toHaveBeenCalledWith('test-session-123', 'bHMN');
  });


  it('sends the fitted size after attachment even when fit emits no further resize', async () => {
    const { promise, resolve: resolveAttach } = Promise.withResolvers<unknown[]>();
    mocks.mockAttachSession.mockReturnValueOnce(promise);
    render(<TerminalContainer sessionId="late-attachment" />);

    act(() => {
      mocks.state.terminal!.rows = 32;
      mocks.state.terminal!.cols = 100;
      mocks.state.onResizeCallback!({ rows: 32, cols: 100 });
    });
    expect(mocks.mockResizeSession).not.toHaveBeenCalled();

    await act(async () => {
      resolveAttach([undefined, undefined]); 
    });
    expect(mocks.mockResizeSession).toHaveBeenCalledExactlyOnceWith('late-attachment', 32, 100);
  });

  it('encodes terminal input as base64 for the byte-slice session binding', async () => {
    await act(async () => {
      render(<TerminalContainer sessionId="test-session-123" />);
    });

    expect(mocks.state.onDataCallback).toBeTruthy();

    await act(async () => {
      mocks.state.onDataCallback!('hello');
    });

    expect(mocks.mockWriteSession).toHaveBeenCalledWith('test-session-123', 'aGVsbG8=');
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


  it('preserves command bytes by waiting for each input write before dispatching the next', async () => {
    const first = Promise.withResolvers<void>();
    mocks.mockWriteSession.mockReturnValueOnce(first.promise);
    await act(async () => {
      render(<TerminalContainer sessionId="ordered-input" />); 
    });
    act(() => {
      mocks.state.onDataCallback!('i');
      mocks.state.onDataCallback!('d\r');
    });
    await act(async () => {
      await Promise.resolve(); 
    });
    try {
      expect(mocks.mockWriteSession).toHaveBeenCalledTimes(1);
    } finally {
      await act(async () => {
        first.resolve(); 
      });
    }

    // Go decodes each []byte binding argument before assembling terminal input.
    const writes = mocks.mockWriteSession.mock.calls.map(
      (call: unknown[]) => Buffer.from(call[1] as string, 'base64'),
    );
    expect(Buffer.concat(writes).toString('utf8')).toBe('id\r');
  });

  it('does not dispatch queued input after the terminal detaches', async () => {
    const first = Promise.withResolvers<void>();
    mocks.mockWriteSession.mockReturnValueOnce(first.promise);
    const view = render(<TerminalContainer sessionId="disposed-input" />);
    await act(async () => {
      await Promise.resolve(); 
    });
    act(() => {
      mocks.state.onDataCallback!('first');
      mocks.state.onDataCallback!('must-not-reach-detached-session');
    });
    await act(async () => {
      await Promise.resolve(); 
    });
    view.unmount();
    await act(async () => {
      first.resolve(); 
    });
    expect(mocks.mockWriteSession).toHaveBeenCalledTimes(1);
  });

  it('announces attachment failure and does not accept input for an unattached session', async () => {
    mocks.mockAttachSession.mockRejectedValueOnce(new Error('Session vanished'));
    await act(async () => {
      render(<TerminalContainer sessionId="failed-attachment" />); 
    });
    expect(screen.getByRole('alert')).toBeVisible();
    expect(mocks.state.onDataCallback).toBeNull();
  });

  it('stops queued and future input after an uncertain write failure', async () => {
    mocks.mockWriteSession.mockRejectedValueOnce(new Error('Connection lost'));
    await act(async () => {
      render(<TerminalContainer sessionId="failed-input" />); 
    });
    act(() => {
      mocks.state.onDataCallback!('first');
      mocks.state.onDataCallback!('must-not-follow-uncertain-write');
    });
    await act(async () => {
      await Promise.resolve(); 
    });
    expect(screen.getByRole('alert')).toBeVisible();
    expect(mocks.mockWriteSession).toHaveBeenCalledTimes(1);
    act(() => {
      mocks.state.onDataCallback!('must-not-send-after-error'); 
    });
    await act(async () => {
      await Promise.resolve(); 
    });
    expect(mocks.mockWriteSession).toHaveBeenCalledTimes(1);
  });

  it('offers an explicit plugin recovery only for eligible stream errors', async () => {
    const recover = vi.fn().mockResolvedValue(undefined);
    const canRecover = vi.fn((info: { title: string }) => info.title === 'Shell not found');
    await act(async () => {
      render(<TerminalContainer sessionId="recoverable-stream" tab={{
        title: 'app/main', properties: {
          pluginID: 'kubernetes', connectionID: 'kind-kind',
          recovery: { label: 'Debug this container', canRecover, run: recover },
        },
      } as unknown as BottomDrawerTab} />);
    });
    const handler = mocks.mockEventsOn.mock.calls.find(([name]) => name === 'core/exec/signal/ERROR/recoverable-stream')?.[1];
    expect(handler).toBeDefined();
    act(() => {
      handler!({ data: { title: 'Permission denied', message: 'Forbidden: pods/exec', suggestion: 'Request access.' } }); 
    });
    expect(screen.queryByRole('button', { name: 'Debug this container' })).not.toBeInTheDocument();
    act(() => {
      handler!({ data: { title: 'Shell not found', message: 'exec: sh: executable file not found', suggestion: 'No shell installed.' } }); 
    });
    expect(recover).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Debug this container' }));
    await act(async () => {
      await Promise.resolve(); 
    });
    expect(recover).toHaveBeenCalledTimes(1);
  });

  it('applies the latest size only after the previous backend resize completes', async () => {
    const firstResize = Promise.withResolvers<void>();
    mocks.mockResizeSession.mockReturnValueOnce(firstResize.promise).mockResolvedValue(undefined);
    await act(async () => {
      render(<TerminalContainer sessionId="ordered-resizes" />);
    });
    expect(mocks.mockResizeSession).toHaveBeenCalledTimes(1);
    act(() => {
      mocks.state.onResizeCallback!({ rows: 30, cols: 100 });
      mocks.state.onResizeCallback!({ rows: 40, cols: 120 });
    });
    expect(mocks.mockResizeSession).toHaveBeenCalledTimes(1);
    await act(async () => {
      firstResize.resolve();
    });
    expect(mocks.mockResizeSession.mock.calls.map(call => call.slice(1))).toEqual([[24, 80], [40, 120]]);
  });

  it('waits for a hidden terminal to become measurable before fitting', async () => {
    containerWidth = 0;
    containerHeight = 0;
    await act(async () => {
      render(<TerminalContainer sessionId="hidden-terminal" />);
      flushFits();
    });
    expect(mocks.mockFit).not.toHaveBeenCalled();
    containerWidth = 800;
    containerHeight = 400;
    act(() => {
      resizeObserverCallback!([], {} as ResizeObserver);
    });
    expect(mocks.mockFit).toHaveBeenCalledOnce();
    act(flushFits);
    expect(mocks.mockFit).toHaveBeenCalledOnce();
  });

  it('cancels pending fits and ignores late attachment after unmount', async () => {
    const attachment = Promise.withResolvers<unknown[]>();
    mocks.mockAttachSession.mockReturnValueOnce(attachment.promise);
    const view = render(<TerminalContainer sessionId="closed-before-attach" />);
    view.unmount();
    await act(async () => {
      attachment.resolve([undefined, undefined]);
      flushFits();
    });
    expect(mocks.mockResizeSession).not.toHaveBeenCalled();
    expect(mocks.mockFit).not.toHaveBeenCalled();
  });
});
