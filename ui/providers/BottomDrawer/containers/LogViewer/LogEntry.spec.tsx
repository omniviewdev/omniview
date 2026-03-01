import React from 'react';
import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import LogEntryComponent from './LogEntry';
import type { LogEntry, SearchMatch } from './types';

// Mock scrollIntoView — jsdom doesn't implement it
const scrollIntoView = vi.fn();
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
  colorize: true,
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
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
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

  // ---- Selection (user-select) ----

  it('source badge is not user-selectable', () => {
    render(
      <LogEntryComponent entry={makeEntry()} {...defaultProps} showSources />,
    );
    const badge = screen.getByText('pod-a');
    expect(badge.style.userSelect).toBe('none');
    expect(badge.style.webkitUserSelect).toBe('none');
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
    vi.advanceTimersByTime(16);

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

    vi.advanceTimersByTime(16);
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

    vi.advanceTimersByTime(16);

    // scrollIntoView should be called exactly once (only the current match)
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });

  // ---- ANSI color rendering ----

  it('renders ANSI-colored content with styled spans', () => {
    const { container } = render(
      <LogEntryComponent
        entry={makeEntry({
          content: 'ERROR something broke',
          ansiSegments: [
            { text: 'ERROR', fg: '#cc0000', bold: true },
            { text: ' something broke' },
          ],
        })}
        {...defaultProps}
      />,
    );

    // Full text should be present across elements
    expect(container.textContent).toContain('ERROR something broke');

    // The ERROR span should have red color and bold
    const errorSpan = screen.getByText('ERROR');
    expect(errorSpan.tagName).toBe('SPAN');
    expect(errorSpan.style.color).toBe('rgb(204, 0, 0)');
    expect(errorSpan.style.fontWeight).toBe('bold');

    // The unstyled text should be a bare text node (no wrapper span)
    expect(container.textContent).toContain(' something broke');
  });

  it('renders plain content when ansiSegments is undefined', () => {
    render(
      <LogEntryComponent
        entry={makeEntry({ content: 'plain text', ansiSegments: undefined })}
        {...defaultProps}
      />,
    );
    expect(screen.getByText('plain text')).toBeInTheDocument();
  });

  it('renders ANSI segments with search highlights overlaid', () => {
    // content = "ERROR normal" (stripped), segments carry color
    const matches: SearchMatch[] = [
      { lineIndex: 0, startOffset: 0, endOffset: 5 }, // "ERROR"
    ];
    const { container } = render(
      <LogEntryComponent
        entry={makeEntry({
          content: 'ERROR normal',
          ansiSegments: [
            { text: 'ERROR', fg: '#cc0000' },
            { text: ' normal' },
          ],
        })}
        {...defaultProps}
        searchMatches={matches}
        currentMatchOffset={0}
      />,
    );

    // The highlighted ERROR span should have orange background (search highlight)
    const orangeSpans = spansByBg(container, ORANGE);
    expect(orangeSpans).toHaveLength(1);
    expect(orangeSpans[0]).toHaveTextContent('ERROR');
  });

  // ---- colorize={false} ----

  it('renders plain text when colorize is false even with ansiSegments', () => {
    const { container } = render(
      <LogEntryComponent
        entry={makeEntry({
          content: 'ERROR something broke',
          ansiSegments: [
            { text: 'ERROR', fg: '#cc0000', bold: true },
            { text: ' something broke' },
          ],
        })}
        {...defaultProps}
        colorize={false}
      />,
    );

    // Full text should render
    expect(container.textContent).toContain('ERROR something broke');

    // No color-styled spans should exist
    const colorSpans = Array.from(container.querySelectorAll('span')).filter(
      (el) => el.style.color === 'rgb(204, 0, 0)',
    );
    expect(colorSpans).toHaveLength(0);
  });

  it('renders search highlights with colorize={false}', () => {
    const matches: SearchMatch[] = [
      { lineIndex: 0, startOffset: 0, endOffset: 5 }, // "ERROR"
    ];
    const { container } = render(
      <LogEntryComponent
        entry={makeEntry({
          content: 'ERROR something broke',
          ansiSegments: [
            { text: 'ERROR', fg: '#cc0000' },
            { text: ' something broke' },
          ],
        })}
        {...defaultProps}
        colorize={false}
        searchMatches={matches}
        currentMatchOffset={0}
      />,
    );

    // Search highlight should still work (orange for current match)
    const orangeSpans = spansByBg(container, ORANGE);
    expect(orangeSpans).toHaveLength(1);
    expect(orangeSpans[0]).toHaveTextContent('ERROR');

    // But no ANSI color spans
    const colorSpans = Array.from(container.querySelectorAll('span')).filter(
      (el) => el.style.color === 'rgb(204, 0, 0)',
    );
    expect(colorSpans).toHaveLength(0);
  });

  it('renders search highlight that spans across ANSI segment boundaries', () => {
    // content = "helloworld" (stripped), search matches "llowor" (offsets 2-8)
    const matches: SearchMatch[] = [
      { lineIndex: 0, startOffset: 2, endOffset: 8 }, // "llowor"
    ];
    const { container } = render(
      <LogEntryComponent
        entry={makeEntry({
          content: 'helloworld',
          ansiSegments: [
            { text: 'hello', fg: '#4e9a06' },   // green
            { text: 'world', fg: '#3465a4' },    // blue
          ],
        })}
        {...defaultProps}
        searchMatches={matches}
        currentMatchOffset={2}
      />,
    );

    // Should have orange highlight spans for the match
    const orangeSpans = spansByBg(container, ORANGE);
    expect(orangeSpans.length).toBeGreaterThanOrEqual(1);
    // Combined text of all orange spans should be "llowor"
    const orangeText = orangeSpans.map(s => s.textContent).join('');
    expect(orangeText).toBe('llowor');
  });
});
