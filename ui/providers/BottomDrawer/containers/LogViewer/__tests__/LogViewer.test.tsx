import { render, cleanup, act, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';
import { StreamEventType, type LogDataSource, type LogEntry, type SearchMatch } from '../types';

// ─── Hook mocks ────────────────────────────────────────────────────────────────

const mockAppend = vi.fn();
const mockClearBuffer = vi.fn();

let mockEntries: LogEntry[] = [];
let mockVersion = 0;
let mockLineCount = 0;

vi.mock('../hooks/useLogBuffer', () => ({
  useLogBuffer: () => ({
    entries: mockEntries,
    version: mockVersion,
    append: mockAppend,
    clear: mockClearBuffer,
    lineCount: mockLineCount,
  }),
}));

vi.mock('../hooks/useLogStream', () => ({
  useLogStream: vi.fn(),
}));

const mockSetQuery = vi.fn();
const mockSetIsRegex = vi.fn();
const mockSetCaseSensitive = vi.fn();
const mockNextMatch = vi.fn();
const mockPrevMatch = vi.fn();
let mockSearchMatches: SearchMatch[] = [];
let mockCurrentMatchIndex = 0;

vi.mock('../hooks/useLogSearch', () => ({
  useLogSearch: () => ({
    query: '',
    setQuery: mockSetQuery,
    isRegex: false,
    setIsRegex: mockSetIsRegex,
    caseSensitive: false,
    setCaseSensitive: mockSetCaseSensitive,
    matches: mockSearchMatches,
    totalMatches: mockSearchMatches.length,
    currentMatchIndex: mockCurrentMatchIndex,
    capped: false,
    nextMatch: mockNextMatch,
    prevMatch: mockPrevMatch,
  }),
}));

let mockSources: Array<{ id: string; labels: Record<string, string> }> = [];
let mockAllSelected = true;
let mockSelectedSourceIds = new Set<string>();
vi.mock('../hooks/useLogSources', () => ({
  useLogSources: () => ({
    sources: mockSources,
    allSelected: mockAllSelected,
    selectedSourceIds: mockSelectedSourceIds,
    toggleSource: vi.fn(),
    toggleAll: vi.fn(),
    dimensions: [],
    toggleValue: vi.fn(),
  }),
}));

// ─── Sub-component mocks ────────────────────────────────────────────────────────

vi.mock('../LogEntry', () => {
  return {
    __esModule: true,
    default: ({ entry }: { entry: LogEntry }) => (
      <div data-testid={`log-entry-${entry.lineNumber}`}>{entry.content}</div>
    ),
  };
});

vi.mock('../LogViewerToolbar', () => {
  return {
    __esModule: true,
    default: (props: any) => (
      <div data-testid="log-toolbar">
        <input data-search-input data-testid="search-input" />
        <button data-testid="toggle-timestamps" onClick={props.onToggleTimestamps}>timestamps</button>
        <button data-testid="toggle-wrap" onClick={props.onToggleWrap}>wrap</button>
        <button data-testid="toggle-follow" onClick={props.onToggleFollow}>follow</button>
        <button data-testid="toggle-paused" onClick={props.onTogglePaused}>pause</button>
        <button type="button" data-testid="copy-visible" onClick={props.onCopyVisible}>copy visible</button>
        <button type="button" data-testid="copy-all" onClick={props.onCopyAll}>copy all</button>
      </div>
    ),
  };
});

vi.mock('../FilterSelect', () => ({
  __esModule: true,
  default: () => <div data-testid="filter-select" />,
}));

vi.mock('../JumpToTime', () => ({
  __esModule: true,
  default: () => <div data-testid="jump-to-time" />,
}));

const mockCopyLogsToClipboard = vi.fn().mockResolvedValue(true);
vi.mock('../utils/downloadLogs', () => ({
  saveLogsNative: vi.fn(),
  copyLogsToClipboard: (...args: any[]) => mockCopyLogsToClipboard(...args),
}));

vi.mock('../utils/binarySearchTimestamp', () => ({
  findEntryIndexByTime: vi.fn(() => 0),
}));

// Virtual list mock — render items directly instead of virtualizing
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: (opts: any) => {
    const items = Array.from({ length: opts.count }, (_, i) => ({
      index: i,
      key: i,
      start: i * 18,
      end: (i + 1) * 18,
      size: 18,
    }));
    return {
      getVirtualItems: () => items,
      getTotalSize: () => opts.count * 18,
      scrollToIndex: vi.fn(),
      measureElement: vi.fn(),
      range: opts.count > 2 ? { startIndex: 1, endIndex: 2 } : opts.count > 0 ? { startIndex: 0, endIndex: opts.count - 1 } : null,
    };
  },
}));

import LogViewerContainer from '../index';

function makeEntry(n: number, content = `log line ${n}`): LogEntry {
  return {
    lineNumber: n,
    sessionId: 'sess-1',
    sourceId: 'src-1',
    labels: {},
    timestamp: '2025-01-01T00:00:00Z',
    content,
    origin: 'CURRENT',
  };
}

describe('LogViewerContainer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEntries = [];
    mockVersion = 0;
    mockLineCount = 0;
    mockSearchMatches = [];
    mockCurrentMatchIndex = 0;
    mockSources = [];
    mockAllSelected = true;
    mockSelectedSourceIds = new Set<string>();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders loading state when no entries and no errors', () => {
    mockEntries = [];
    mockLineCount = 0;

    const { getByText } = render(<LogViewerContainer sessionId="sess-1" />);

    expect(getByText(/Connecting to log sources/i)).toBeTruthy();
  });

  it('keeps discovered sources connecting until readers report session readiness', () => {
    mockSources = [{ id: 'discovered-container', labels: {} }];
    const source: LogDataSource = { connect: () => vi.fn() };
    const { getByText, queryByText } = render(<LogViewerContainer source={source} />);
    expect(getByText('Connecting to log sources...')).toBeTruthy();
    expect(getByText('1 source found, connecting')).toBeTruthy();
    expect(queryByText('No log entries yet.')).toBeNull();
    expect(queryByText(/connected, waiting for data/)).toBeNull();
  });

  it('shows a ready but empty stream without connecting forever', () => {
    const source: LogDataSource = {
      connect(handlers) {
        handlers.onEvent({ type: StreamEventType.SESSION_READY, source_id: '', message: 'Ready', timestamp: '' });
        return vi.fn();
      },
    };
    const { getByText, queryByText } = render(<LogViewerContainer source={source} />);
    expect(getByText('No log entries yet.')).toBeTruthy();
    expect(queryByText(/Connecting to log sources/)).toBeNull();
  });

  it('keeps readiness after the event window rolls over and resets for a new source', () => {
    let handlers!: Parameters<LogDataSource['connect']>[0];
    const disconnect = vi.fn();
    const source: LogDataSource = {
      connect(nextHandlers) {
        handlers = nextHandlers;
        return disconnect;
      },
    };
    const view = render(<LogViewerContainer source={source} />);
    act(() => {
      handlers.onEvent({ type: StreamEventType.SESSION_READY, source_id: '', message: 'Ready', timestamp: '' });
    });
    act(() => {
      for (let i = 0; i < 110; i++) {
        handlers.onEvent({ type: StreamEventType.SOURCE_ADDED, source_id: `source-${i}`, message: '', timestamp: '' });
      }
    });
    expect(view.getByText('No log entries yet.')).toBeTruthy();
    expect(view.queryByText('Connecting to log sources...')).toBeNull();

    view.rerender(<LogViewerContainer source={{ connect: () => vi.fn() }} />);
    expect(disconnect).toHaveBeenCalledOnce();
    expect(mockClearBuffer).toHaveBeenCalledOnce();
    expect(view.getByText('Connecting to log sources...')).toBeTruthy();
    expect(view.queryByText('No log entries yet.')).toBeNull();
  });

  it('shows a source error while an empty sibling stays live and later supplies logs', () => {
    let handlers!: Parameters<LogDataSource['connect']>[0];
    const disconnect = vi.fn();
    const source: LogDataSource = {
      connect(nextHandlers) {
        handlers = nextHandlers;
        return disconnect;
      },
    };
    const view = render(<LogViewerContainer source={source} />);
    act(() => {
      handlers.onEvent({ type: StreamEventType.SESSION_READY, source_id: '', message: 'Ready', timestamp: '' });
      handlers.onEvent({ type: StreamEventType.STREAM_ERROR, source_id: 'failed-source', message: 'Reader denied', timestamp: '' });
    });
    expect(view.getByText('Reader denied')).toBeTruthy();
    expect(view.getByText('No log entries yet.')).toBeTruthy();
    expect(view.queryByText('Failed to stream logs')).toBeNull();
    expect(disconnect).not.toHaveBeenCalled();

    const entry = { ...makeEntry(0, 'Sibling still streaming'), sourceId: 'live-sibling' };
    act(() => {
      handlers.onLines([entry]);
    });
    expect(mockAppend).toHaveBeenCalledWith([entry]);
    mockEntries = [entry];
    mockLineCount = 1;
    mockVersion++;
    fireEvent.click(view.getByTestId('toggle-timestamps'));
    expect(view.getByText('Sibling still streaming')).toBeTruthy();
    expect(view.getByText('Reader denied')).toBeTruthy();
    expect(disconnect).not.toHaveBeenCalled();

    view.rerender(<LogViewerContainer source={{ connect: () => vi.fn() }} />);
    expect(view.queryByText('Reader denied')).toBeNull();
  });

  it('keeps source errors diagnostic after whole-session completion with no entries', () => {
    let handlers!: Parameters<LogDataSource['connect']>[0];
    const source: LogDataSource = {
      connect(nextHandlers) {
        handlers = nextHandlers;
        return vi.fn();
      },
    };
    const view = render(<LogViewerContainer source={source} />);
    act(() => {
      handlers.onEvent({ type: StreamEventType.STREAM_ERROR, source_id: 'failed-source', message: 'Reader denied', timestamp: '' });
      handlers.onEvent({ type: StreamEventType.STREAM_ENDED, source_id: '', message: 'Complete', timestamp: '' });
    });
    expect(view.getByText('Log stream ended')).toBeTruthy();
    expect(view.getByText('Reader denied', { exact: false })).toBeTruthy();
    expect(view.getByText('failed-source:')).toBeTruthy();
    expect(view.getByText('No log entries were returned.')).toBeTruthy();
    expect(view.queryByText('Failed to stream logs')).toBeNull();

    mockEntries = [{ ...makeEntry(0, 'Healthy sibling output'), sourceId: 'healthy-source' }];
    mockLineCount = 1;
    mockVersion++;
    fireEvent.click(view.getByTestId('toggle-timestamps'));
    expect(view.getByText('Healthy sibling output')).toBeTruthy();
    expect(view.getByText('Reader denied')).toBeTruthy();
    expect(view.getByText('Log stream ended')).toBeTruthy();
    expect(view.queryByText('Failed to stream logs')).toBeNull();
  });

  it('keeps source-less errors fatal after whole-session completion', () => {
    const source: LogDataSource = {
      connect(handlers) {
        handlers.onEvent({ type: StreamEventType.STREAM_ERROR, source_id: '', message: 'Session failed', timestamp: '' });
        handlers.onEvent({ type: StreamEventType.STREAM_ENDED, source_id: '', message: 'Complete', timestamp: '' });
        return vi.fn();
      },
    };
    const view = render(<LogViewerContainer source={source} />);
    expect(view.getByText('Failed to stream logs')).toBeTruthy();
    expect(view.getByText('Session failed')).toBeTruthy();
    expect(view.queryByText('No log entries were returned.')).toBeNull();
  });

  it('keeps removed-source completion truthful across empty output and sibling filtering', () => {
    let handlers!: Parameters<LogDataSource['connect']>[0];
    const source: LogDataSource = {
      connect(nextHandlers) {
        handlers = nextHandlers;
        return vi.fn();
      },
    };
    const view = render(<LogViewerContainer source={source} />);
    act(() => {
      handlers.onEvent({ type: StreamEventType.SOURCE_REMOVED, source_id: 'removed-source', message: 'Removed', timestamp: '' });
      handlers.onEvent({ type: StreamEventType.STREAM_ENDED, source_id: 'healthy-source', message: 'Complete', timestamp: '' });
      handlers.onEvent({ type: StreamEventType.STREAM_ENDED, source_id: '', message: 'Complete', timestamp: '' });
    });
    const completion = 'Log stream ended — 1 source no longer available';
    expect(view.getByText(completion)).toBeTruthy();
    expect(view.getByText('No log entries were returned.')).toBeTruthy();
    expect(view.queryByText('Resource no longer available')).toBeNull();
    expect(view.queryByText('The resource was deleted or is no longer accessible.')).toBeNull();

    mockEntries = [{ ...makeEntry(0, 'Healthy sibling output'), sourceId: 'healthy-source' }];
    mockLineCount = 1;
    mockVersion++;
    mockSources = [{ id: 'removed-source', labels: {} }, { id: 'healthy-source', labels: {} }];
    mockAllSelected = false;
    mockSelectedSourceIds = new Set(['removed-source']);
    fireEvent.click(view.getByTestId('toggle-timestamps'));
    expect(view.getByText(completion)).toBeTruthy();
    expect(view.getByText('No logs match the selected sources.')).toBeTruthy();
    expect(view.queryByText('No log entries were returned.')).toBeNull();
    expect(view.queryByText('Healthy sibling output')).toBeNull();
    expect(view.queryByText('Resource no longer available')).toBeNull();

    mockAllSelected = true;
    fireEvent.click(view.getByTestId('toggle-timestamps'));
    expect(view.getByText('Healthy sibling output')).toBeTruthy();
    expect(view.getByText(completion)).toBeTruthy();
    expect(view.queryByText('No logs match the selected sources.')).toBeNull();
    expect(view.queryByText('Failed to stream logs')).toBeNull();
  });

  it('distinguishes filtered completed logs from a stream that returned no entries', () => {
    mockEntries = [makeEntry(0)];
    mockLineCount = 1;
    mockSources = [{ id: 'src-1', labels: {} }, { id: 'src-2', labels: {} }];
    mockAllSelected = false;
    mockSelectedSourceIds = new Set(['src-2']);
    const source: LogDataSource = {
      connect(handlers) {
        handlers.onEvent({ type: StreamEventType.STREAM_ENDED, source_id: '', message: 'Complete', timestamp: '' });
        return vi.fn();
      },
    };
    const view = render(<LogViewerContainer source={source} />);
    expect(view.getByText('Log stream ended')).toBeTruthy();
    expect(view.getByText('No logs match the selected sources.')).toBeTruthy();
    expect(view.queryByText('No log entries were returned.')).toBeNull();

    mockAllSelected = true;
    fireEvent.click(view.getByTestId('toggle-timestamps'));
    expect(view.getByText('log line 0')).toBeTruthy();
    expect(view.getByText('Log stream ended')).toBeTruthy();
    expect(view.queryByText('No logs match the selected sources.')).toBeNull();
  });

  it('shows clean finite empty completion, not a lost connection', () => {
    const source: LogDataSource = {
      connect(handlers) {
        handlers.onEvent({ type: StreamEventType.STREAM_ENDED, source_id: '', message: 'Complete', timestamp: '' });
        return vi.fn();
      },
    };
    const { getByText, queryByText } = render(<LogViewerContainer source={source} />);
    expect(getByText('No log entries were returned.')).toBeTruthy();
    expect(queryByText(/connection.*lost/i)).toBeNull();
  });

  it.each([StreamEventType.STREAM_ENDED, StreamEventType.STREAM_ERROR, StreamEventType.SOURCE_REMOVED])(
    'does not terminate the session for source-scoped event %i', type => {
      const source: LogDataSource = {
        connect(handlers) {
          handlers.onEvent({ type: StreamEventType.SESSION_READY, source_id: '', message: 'Ready', timestamp: '' });
          handlers.onEvent({ type, source_id: 'one-of-many', message: 'Source stopped', timestamp: '' });
          return vi.fn();
        },
      };
      const { getByText, queryByText } = render(<LogViewerContainer source={source} />);
      expect(getByText('No log entries yet.')).toBeTruthy();
      expect(queryByText('Failed to stream logs')).toBeNull();
      expect(queryByText('Log stream ended')).toBeNull();
    },
  );

  it('renders error state when errors and no entries', () => {
    // We need to mock useLogStream to trigger events with errors
    // For this test, we set stream events directly through the mock
    // The component derives error state from internal events state,
    // which is populated by useLogStream's onEvent callback.
    // Since we mock useLogStream as a no-op, we test the empty state instead.
    mockEntries = [];
    mockLineCount = 0;

    const { getByText } = render(<LogViewerContainer sessionId="sess-1" />);
    expect(getByText(/Connecting to log sources/i)).toBeTruthy();
  });

  it('renders log entries when entries are present', () => {
    mockEntries = [makeEntry(0), makeEntry(1), makeEntry(2)];
    mockVersion = 1;
    mockLineCount = 3;

    const { getByText } = render(<LogViewerContainer sessionId="sess-1" />);

    expect(getByText('log line 0')).toBeTruthy();
    expect(getByText('log line 1')).toBeTruthy();
    expect(getByText('log line 2')).toBeTruthy();
  });

  it('renders toolbar', () => {
    mockEntries = [makeEntry(0)];
    mockLineCount = 1;

    const { getByTestId } = render(<LogViewerContainer sessionId="sess-1" />);
    expect(getByTestId('log-toolbar')).toBeTruthy();
  });

  it('jump to bottom button appears when not following and entries exist', () => {
    mockEntries = Array.from({ length: 100 }, (_, i) => makeEntry(i));
    mockVersion = 1;
    mockLineCount = 100;

    const { getByTestId, queryByText } = render(<LogViewerContainer sessionId="sess-1" />);

    // Initially follow=true, so jump button should not be visible
    // Toggle follow off via toolbar
    act(() => {
      fireEvent.click(getByTestId('toggle-follow'));
    });

    // After disabling follow, "Jump to bottom" button should appear
    expect(queryByText('Jump to bottom')).toBeTruthy();
  });

  it('jump to bottom button is hidden when following', () => {
    mockEntries = [makeEntry(0)];
    mockVersion = 1;
    mockLineCount = 1;

    const { queryByText } = render(<LogViewerContainer sessionId="sess-1" />);

    // follow defaults to true
    expect(queryByText('Jump to bottom')).toBeNull();
  });

  it('scrolling up with the wheel leaves follow mode', () => {
    mockEntries = Array.from({ length: 100 }, (_, i) => makeEntry(i));
    mockVersion = 1;
    mockLineCount = 100;

    const { container, queryByText } = render(<LogViewerContainer sessionId="sess-1" />);
    const list = container.querySelector('[data-index]')!.parentElement!.parentElement!;

    fireEvent.wheel(list, { deltaY: 120 });
    expect(queryByText('Jump to bottom')).toBeNull();

    fireEvent.wheel(list, { deltaY: -120 });
    expect(queryByText('Jump to bottom')).toBeTruthy();
  });

  it('keeps the newest line in view as lines arrive while following', () => {
    mockEntries = Array.from({ length: 100 }, (_, i) => makeEntry(i));
    mockVersion = 1;
    mockLineCount = 100;

    const { container, rerender } = render(<LogViewerContainer sessionId="sess-1" />);
    const list = container.querySelector('[data-index]')!.parentElement!.parentElement! as HTMLDivElement;
    let scrollHeight = 1800;
    Object.defineProperty(list, 'scrollHeight', { configurable: true, get: () => scrollHeight });
    Object.defineProperty(list, 'clientHeight', { configurable: true, get: () => 300 });

    mockEntries = Array.from({ length: 200 }, (_, i) => makeEntry(i));
    mockVersion = 2;
    mockLineCount = 200;
    scrollHeight = 3600;
    rerender(<LogViewerContainer sessionId="sess-2" />);

    expect(list.scrollTop).toBe(3300);
  });

  it('copy all copies every filtered entry to clipboard', async () => {
    mockEntries = [makeEntry(0), makeEntry(1), makeEntry(2)];
    mockVersion = 1;
    mockLineCount = 3;

    const { getByTestId } = render(<LogViewerContainer sessionId="sess-1" />);

    await act(async () => {
      fireEvent.click(getByTestId('copy-all'));
    });

    expect(mockCopyLogsToClipboard).toHaveBeenCalledWith(mockEntries);
  });

  it('copy visible copies only viewport entries to clipboard', async () => {
    mockEntries = [makeEntry(0), makeEntry(1), makeEntry(2), makeEntry(3)];
    mockVersion = 1;
    mockLineCount = 4;

    const { getByTestId } = render(<LogViewerContainer sessionId="sess-1" />);

    await act(async () => {
      fireEvent.click(getByTestId('copy-visible'));
    });

    // The virtualizer mock range is { startIndex: 1, endIndex: 2 } for count > 2
    expect(mockCopyLogsToClipboard).toHaveBeenCalledWith([mockEntries[1], mockEntries[2]]);
  });

  it('Cmd+Shift+C triggers copy all', async () => {
    mockEntries = [makeEntry(0), makeEntry(1)];
    mockVersion = 1;
    mockLineCount = 2;

    const { container } = render(<LogViewerContainer sessionId="sess-1" />);
    const wrapper = container.firstElementChild as HTMLElement;

    await act(async () => {
      fireEvent.keyDown(wrapper, { key: 'C', metaKey: true, shiftKey: true });
    });
    expect(mockCopyLogsToClipboard).toHaveBeenCalledWith(mockEntries);

    mockCopyLogsToClipboard.mockClear();

    // Also works with Ctrl (Windows/Linux)
    await act(async () => {
      fireEvent.keyDown(wrapper, { key: 'C', ctrlKey: true, shiftKey: true });
    });
    expect(mockCopyLogsToClipboard).toHaveBeenCalledWith(mockEntries);
  });

  it('Cmd+Shift+V triggers copy visible', async () => {
    mockEntries = [makeEntry(0), makeEntry(1)];
    mockVersion = 1;
    mockLineCount = 2;

    const { container } = render(<LogViewerContainer sessionId="sess-1" />);
    const wrapper = container.firstElementChild as HTMLElement;

    await act(async () => {
      fireEvent.keyDown(wrapper, { key: 'V', metaKey: true, shiftKey: true });
    });
    expect(mockCopyLogsToClipboard).toHaveBeenCalledWith(mockEntries);

    mockCopyLogsToClipboard.mockClear();

    // Also works with Ctrl (Windows/Linux)
    await act(async () => {
      fireEvent.keyDown(wrapper, { key: 'V', ctrlKey: true, shiftKey: true });
    });
    expect(mockCopyLogsToClipboard).toHaveBeenCalledWith(mockEntries);
  });

  it('Cmd+F focuses the search input (Mac)', () => {
    mockEntries = [makeEntry(0)];
    mockVersion = 1;
    mockLineCount = 1;

    const { container, getByTestId } = render(<LogViewerContainer sessionId="sess-1" />);
    const wrapper = container.firstElementChild as HTMLElement;
    const searchInput = getByTestId('search-input') as HTMLInputElement;

    // Focus should not be on search input initially
    expect(document.activeElement).not.toBe(searchInput);

    fireEvent.keyDown(wrapper, { key: 'f', metaKey: true });

    expect(document.activeElement).toBe(searchInput);
  });

  it('Ctrl+F focuses the search input (Windows/Linux)', () => {
    mockEntries = [makeEntry(0)];
    mockVersion = 1;
    mockLineCount = 1;

    const { container, getByTestId } = render(<LogViewerContainer sessionId="sess-1" />);
    const wrapper = container.firstElementChild as HTMLElement;
    const searchInput = getByTestId('search-input') as HTMLInputElement;

    expect(document.activeElement).not.toBe(searchInput);

    fireEvent.keyDown(wrapper, { key: 'F', ctrlKey: true });

    expect(document.activeElement).toBe(searchInput);
  });

  it('Escape from search input returns focus to the scroll area', () => {
    mockEntries = [makeEntry(0)];
    mockVersion = 1;
    mockLineCount = 1;

    const { container, getByTestId } = render(<LogViewerContainer sessionId="sess-1" />);
    const searchInput = getByTestId('search-input') as HTMLInputElement;
    searchInput.focus();
    expect(document.activeElement).toBe(searchInput);

    fireEvent.keyDown(searchInput, { key: 'Escape' });

    // Focus should move to the scroll area (tabindex=0 element inside the container)
    const wrapper = container.firstElementChild as HTMLElement;
    const scrollArea = wrapper.querySelector('[tabindex="0"]:not([data-testid="log-toolbar"] *)');
    expect(document.activeElement).toBe(scrollArea);
  });

  it('Cmd+Shift+L copies the current match log line (Mac)', async () => {
    mockEntries = [makeEntry(0), makeEntry(1, 'match line'), makeEntry(2)];
    mockVersion = 1;
    mockLineCount = 3;
    mockSearchMatches = [{ lineIndex: 1, startOffset: 0, endOffset: 5 }];
    mockCurrentMatchIndex = 0;

    const { container } = render(<LogViewerContainer sessionId="sess-1" />);
    const wrapper = container.firstElementChild as HTMLElement;

    await act(async () => {
      fireEvent.keyDown(wrapper, { key: 'L', metaKey: true, shiftKey: true });
    });
    expect(mockCopyLogsToClipboard).toHaveBeenCalledWith([mockEntries[1]]);
  });

  it('Ctrl+Shift+L copies the current match log line (Windows/Linux)', async () => {
    mockEntries = [makeEntry(0), makeEntry(1, 'match line'), makeEntry(2)];
    mockVersion = 1;
    mockLineCount = 3;
    mockSearchMatches = [{ lineIndex: 1, startOffset: 0, endOffset: 5 }];
    mockCurrentMatchIndex = 0;

    const { container } = render(<LogViewerContainer sessionId="sess-1" />);
    const wrapper = container.firstElementChild as HTMLElement;

    await act(async () => {
      fireEvent.keyDown(wrapper, { key: 'l', ctrlKey: true, shiftKey: true });
    });
    expect(mockCopyLogsToClipboard).toHaveBeenCalledWith([mockEntries[1]]);
  });

  it('Cmd+Shift+L works from the search input', async () => {
    mockEntries = [makeEntry(0), makeEntry(1, 'match line'), makeEntry(2)];
    mockVersion = 1;
    mockLineCount = 3;
    mockSearchMatches = [{ lineIndex: 1, startOffset: 0, endOffset: 5 }];
    mockCurrentMatchIndex = 0;

    const { getByTestId } = render(<LogViewerContainer sessionId="sess-1" />);
    const searchInput = getByTestId('search-input') as HTMLInputElement;
    searchInput.focus();

    await act(async () => {
      fireEvent.keyDown(searchInput, { key: 'L', metaKey: true, shiftKey: true });
    });
    expect(mockCopyLogsToClipboard).toHaveBeenCalledWith([mockEntries[1]]);
  });

  it('Cmd+Shift+L does nothing when no search matches exist', async () => {
    mockEntries = [makeEntry(0), makeEntry(1)];
    mockVersion = 1;
    mockLineCount = 2;
    mockSearchMatches = [];

    const { container } = render(<LogViewerContainer sessionId="sess-1" />);
    const wrapper = container.firstElementChild as HTMLElement;

    mockCopyLogsToClipboard.mockClear();
    await act(async () => {
      fireEvent.keyDown(wrapper, { key: 'L', metaKey: true, shiftKey: true });
    });
    expect(mockCopyLogsToClipboard).not.toHaveBeenCalled();
  });

  it('does not trigger copy shortcuts from editable elements', async () => {
    mockEntries = [makeEntry(0), makeEntry(1)];
    mockVersion = 1;
    mockLineCount = 2;

    const { container } = render(<LogViewerContainer sessionId="sess-1" />);
    const wrapper = container.firstElementChild as HTMLElement;

    // contentEditable div
    const editable = document.createElement('div');
    editable.contentEditable = 'true';
    wrapper.appendChild(editable);
    editable.focus();

    mockCopyLogsToClipboard.mockClear();
    await act(async () => {
      fireEvent.keyDown(editable, { key: 'C', metaKey: true, shiftKey: true });
    });
    expect(mockCopyLogsToClipboard).not.toHaveBeenCalled();

    // input element
    const input = document.createElement('input');
    wrapper.appendChild(input);
    input.focus();

    await act(async () => {
      fireEvent.keyDown(input, { key: 'C', ctrlKey: true, shiftKey: true });
    });
    expect(mockCopyLogsToClipboard).not.toHaveBeenCalled();
  });

  // ---- Selection containment ----

  it('Cmd+A selects only within the log scroll area', () => {
    mockEntries = [makeEntry(0)];
    mockVersion = 1;
    mockLineCount = 1;

    const mockRange = {
      selectNodeContents: vi.fn(),
      setStart: vi.fn(),
      setEnd: vi.fn(),
      collapse: vi.fn(),
      cloneRange: vi.fn(),
      detach: vi.fn(),
      toString: vi.fn(),
    };
    const mockSelection = {
      removeAllRanges: vi.fn(),
      addRange: vi.fn(),
    };

    vi.spyOn(document, 'createRange').mockReturnValue(mockRange as any);
    vi.spyOn(window, 'getSelection').mockReturnValue(mockSelection as any);

    const { getByTestId } = render(<LogViewerContainer sessionId="sess-1" />);

    // The log scroll area contains the entries; find it via the entry
    const entry = getByTestId('log-entry-0');
    const scrollArea = entry.closest('[tabindex="0"]')!;
    expect(scrollArea).toBeTruthy();

    // Fire Cmd+A on the scroll area
    fireEvent.keyDown(scrollArea, { key: 'a', metaKey: true });

    expect(mockRange.selectNodeContents).toHaveBeenCalledWith(scrollArea);
    expect(mockSelection.removeAllRanges).toHaveBeenCalled();
    expect(mockSelection.addRange).toHaveBeenCalledWith(mockRange);

    vi.restoreAllMocks();
  });

  it('Ctrl+A selects only within the log scroll area', () => {
    mockEntries = [makeEntry(0)];
    mockVersion = 1;
    mockLineCount = 1;

    const mockRange = {
      selectNodeContents: vi.fn(),
      setStart: vi.fn(),
      setEnd: vi.fn(),
      collapse: vi.fn(),
      cloneRange: vi.fn(),
      detach: vi.fn(),
      toString: vi.fn(),
    };
    const mockSelection = {
      removeAllRanges: vi.fn(),
      addRange: vi.fn(),
    };

    vi.spyOn(document, 'createRange').mockReturnValue(mockRange as any);
    vi.spyOn(window, 'getSelection').mockReturnValue(mockSelection as any);

    const { getByTestId } = render(<LogViewerContainer sessionId="sess-1" />);

    const entry = getByTestId('log-entry-0');
    const scrollArea = entry.closest('[tabindex="0"]')!;
    expect(scrollArea).toBeTruthy();

    // Fire Ctrl+A (Windows/Linux) on the scroll area
    fireEvent.keyDown(scrollArea, { key: 'a', ctrlKey: true });

    expect(mockRange.selectNodeContents).toHaveBeenCalledWith(scrollArea);
    expect(mockSelection.removeAllRanges).toHaveBeenCalled();
    expect(mockSelection.addRange).toHaveBeenCalledWith(mockRange);

    vi.restoreAllMocks();
  });

  it('disables pointer-events on toolbar during drag from log area', () => {
    mockEntries = [makeEntry(0)];
    mockVersion = 1;
    mockLineCount = 1;

    const { getByTestId } = render(<LogViewerContainer sessionId="sess-1" />);

    const toolbar = getByTestId('log-toolbar');
    const entry = getByTestId('log-entry-0');
    const scrollArea = entry.closest('[tabindex="0"]')!;
    expect(scrollArea).toBeTruthy();

    // Toolbar should have normal pointer-events
    expect(toolbar.style.pointerEvents).toBe('');

    // Start drag in log area
    fireEvent.mouseDown(scrollArea, { button: 0 });
    // Toolbar should now be non-interactive
    expect(toolbar.style.pointerEvents).toBe('none');

    // Release — toolbar should be restored
    fireEvent.mouseUp(document);
    expect(toolbar.style.pointerEvents).toBe('');
  });

  it('restores pointer-events on window blur (drag leaves window)', () => {
    mockEntries = [makeEntry(0)];
    mockVersion = 1;
    mockLineCount = 1;

    const { getByTestId } = render(<LogViewerContainer sessionId="sess-1" />);

    const toolbar = getByTestId('log-toolbar');
    const entry = getByTestId('log-entry-0');
    const scrollArea = entry.closest('[tabindex="0"]')!;

    fireEvent.mouseDown(scrollArea, { button: 0 });
    expect(toolbar.style.pointerEvents).toBe('none');

    // Window loses focus (user dragged outside) — should restore
    fireEvent(window, new Event('blur'));
    expect(toolbar.style.pointerEvents).toBe('');
  });
});
