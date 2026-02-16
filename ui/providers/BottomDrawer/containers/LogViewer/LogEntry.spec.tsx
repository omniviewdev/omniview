import React from 'react';
import { render, screen } from '@testing-library/react';
import LogEntryComponent from './LogEntry';
import type { LogEntry, SearchMatch } from './types';

// Mock scrollIntoView — jsdom doesn't implement it
const scrollIntoView = jest.fn();
Element.prototype.scrollIntoView = scrollIntoView;

function makeEntry(overrides: Partial<LogEntry> = {}): LogEntry {
  return {
    lineNumber: 1,
    sessionId: 'sess-1',
    sourceId: 'pod-a',
    labels: {},
    timestamp: '2024-01-15T10:30:00Z',
    content: 'hello world',
    origin: 'CURRENT',
    ...overrides,
  };
}

const defaultProps = {
  showTimestamps: false,
  showSources: false,
  showLineNumbers: false,
  wrap: false,
};

/** jsdom normalises hex colors to rgb() — match either form. */
const ORANGE = 'rgb(255, 152, 0)';
const YELLOW = 'rgb(255, 235, 59)';

function spansByBg(container: HTMLElement, color: string) {
  return Array.from(container.querySelectorAll('span')).filter(
    (el) => el.style.backgroundColor === color,
  );
}

beforeEach(() => {
  scrollIntoView.mockClear();
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('LogEntryComponent', () => {
  // ---- Rendering ----

  it('renders content text', () => {
    render(<LogEntryComponent entry={makeEntry()} {...defaultProps} />);
    expect(screen.getByText('hello world')).toBeInTheDocument();
  });

  it('shows line number when showLineNumbers is true', () => {
    render(
      <LogEntryComponent
        entry={makeEntry({ lineNumber: 42 })}
        {...defaultProps}
        showLineNumbers
      />,
    );
    expect(screen.getByText('42')).toBeInTheDocument();
  });

  it('hides line number when showLineNumbers is false', () => {
    render(
      <LogEntryComponent entry={makeEntry({ lineNumber: 42 })} {...defaultProps} />,
    );
    expect(screen.queryByText('42')).not.toBeInTheDocument();
  });

  it('shows source badge when showSources is true', () => {
    render(
      <LogEntryComponent entry={makeEntry()} {...defaultProps} showSources />,
    );
    expect(screen.getByText('pod-a')).toBeInTheDocument();
  });

  // ---- Search highlighting ----

  it('renders highlighted spans for search matches', () => {
    const matches: SearchMatch[] = [
      { lineIndex: 0, startOffset: 0, endOffset: 5 }, // "hello"
    ];
    const { container } = render(
      <LogEntryComponent
        entry={makeEntry()}
        {...defaultProps}
        searchMatches={matches}
        currentMatchOffset={-1}
      />,
    );

    const yellowSpans = spansByBg(container, YELLOW);
    expect(yellowSpans).toHaveLength(1);
    expect(yellowSpans[0]).toHaveTextContent('hello');
  });

  it('colors current match orange and non-current yellow', () => {
    const matches: SearchMatch[] = [
      { lineIndex: 0, startOffset: 0, endOffset: 5 },  // "hello"
      { lineIndex: 0, startOffset: 6, endOffset: 11 }, // "world"
    ];
    const { container } = render(
      <LogEntryComponent
        entry={makeEntry()}
        {...defaultProps}
        searchMatches={matches}
        currentMatchOffset={6} // "world" is current
      />,
    );

    const orange = spansByBg(container, ORANGE);
    const yellow = spansByBg(container, YELLOW);

    expect(orange).toHaveLength(1);
    expect(orange[0]).toHaveTextContent('world');
    expect(yellow).toHaveLength(1);
    expect(yellow[0]).toHaveTextContent('hello');
  });

  // ---- Horizontal scroll (the bug) ----

  it('calls scrollIntoView on the current match span', () => {
    const matches: SearchMatch[] = [
      { lineIndex: 0, startOffset: 6, endOffset: 11 }, // "world"
    ];
    render(
      <LogEntryComponent
        entry={makeEntry()}
        {...defaultProps}
        searchMatches={matches}
        currentMatchOffset={6}
      />,
    );

    // Flush the requestAnimationFrame scheduled by the ref callback
    jest.advanceTimersByTime(16);

    expect(scrollIntoView).toHaveBeenCalledWith({
      block: 'nearest',
      inline: 'nearest',
    });
  });

  it('does NOT call scrollIntoView when currentMatchOffset is -1', () => {
    const matches: SearchMatch[] = [
      { lineIndex: 0, startOffset: 0, endOffset: 5 },
    ];
    render(
      <LogEntryComponent
        entry={makeEntry()}
        {...defaultProps}
        searchMatches={matches}
        currentMatchOffset={-1}
      />,
    );

    jest.advanceTimersByTime(16);
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it('does NOT call scrollIntoView on non-current match spans', () => {
    const matches: SearchMatch[] = [
      { lineIndex: 0, startOffset: 0, endOffset: 5 },  // "hello" — NOT current
      { lineIndex: 0, startOffset: 6, endOffset: 11 }, // "world" — current
    ];
    render(
      <LogEntryComponent
        entry={makeEntry()}
        {...defaultProps}
        searchMatches={matches}
        currentMatchOffset={6}
      />,
    );

    jest.advanceTimersByTime(16);

    // scrollIntoView should be called exactly once (only the current match)
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });
});
