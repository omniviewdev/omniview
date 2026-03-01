import React from 'react';
import Box from '@mui/material/Box';
import { Text } from '@omniviewdev/ui/typography';
import type { AnsiSegment, LogEntry as LogEntryType, SearchMatch } from './types';
import { LEVEL_COLORS } from './types';

interface Props {
  entry: LogEntryType;
  showTimestamps: boolean;
  showSources: boolean;
  showLineNumbers: boolean;
  wrap: boolean;
  colorize: boolean;
  searchMatches?: SearchMatch[];
  /** startOffset of the current match on this line, or -1 if current match is on another line */
  currentMatchOffset?: number;
}

// Visually distinct colors for source badges (dark-theme-friendly, muted pastels).
// Each entry is [background, text].
const SOURCE_COLORS: [string, string][] = [
  ['#1a3a4a', '#7ec8e3'], // teal
  ['#3a1a4a', '#c87ee3'], // purple
  ['#1a4a2a', '#7ee3a0'], // green
  ['#4a3a1a', '#e3c87e'], // amber
  ['#1a2a4a', '#7ea0e3'], // blue
  ['#4a1a2a', '#e37e8c'], // rose
  ['#2a4a1a', '#a0e37e'], // lime
  ['#4a1a4a', '#e37ec8'], // magenta
  ['#1a4a4a', '#7ee3d8'], // cyan
  ['#4a2a1a', '#e3a07e'], // orange
  ['#2a1a4a', '#a07ee3'], // indigo
  ['#3a4a1a', '#c8e37e'], // yellow-green
];

/** Deterministic hash for a string → index into the color palette. */
function sourceColorIndex(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = ((hash << 5) - hash + id.charCodeAt(i)) | 0;
  }
  return ((hash % SOURCE_COLORS.length) + SOURCE_COLORS.length) % SOURCE_COLORS.length;
}

function formatTimestamp(ts: string): string {
  if (!ts) return '';
  try {
    const d = new Date(ts);
    return d.toLocaleTimeString(undefined, {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      fractionalSecondDigits: 3,
    });
  } catch {
    return ts;
  }
}

/** Build a CSS style object for an ANSI segment. */
function ansiStyle(seg: AnsiSegment): React.CSSProperties | undefined {
  if (!seg.fg && !seg.bg && !seg.bold && !seg.dim && !seg.italic && !seg.underline && !seg.strikethrough) {
    return undefined;
  }
  const s: React.CSSProperties = {};
  if (seg.fg) s.color = seg.fg;
  if (seg.bg) s.backgroundColor = seg.bg;
  if (seg.bold) s.fontWeight = 'bold';
  if (seg.dim) s.opacity = 0.7;
  if (seg.italic) s.fontStyle = 'italic';
  const deco: string[] = [];
  if (seg.underline) deco.push('underline');
  if (seg.strikethrough) deco.push('line-through');
  if (deco.length > 0) s.textDecoration = deco.join(' ');
  return s;
}

/** Render ANSI segments as styled spans (no search). */
function renderAnsiSegments(segments: AnsiSegment[]): React.ReactNode[] {
  return segments.map((seg, i) => {
    const style = ansiStyle(seg);
    return style ? <span key={i} style={style}>{seg.text}</span> : seg.text;
  });
}

/** Render plain text with search highlights (no ANSI). */
function renderSearchHighlights(
  content: string,
  matches: SearchMatch[],
  currentMatchOffset: number,
  scrollToMatchRef: (node: HTMLSpanElement | null) => void,
): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  for (const match of matches) {
    if (match.startOffset > lastIndex) {
      parts.push(content.slice(lastIndex, match.startOffset));
    }
    const isCurrent = match.startOffset === currentMatchOffset;
    parts.push(
      <span
        key={match.startOffset}
        ref={isCurrent ? scrollToMatchRef : undefined}
        style={{
          backgroundColor: isCurrent ? '#ff9800' : '#ffeb3b',
          color: '#000',
          borderRadius: 2,
        }}
      >
        {content.slice(match.startOffset, match.endOffset)}
      </span>,
    );
    lastIndex = match.endOffset;
  }
  if (lastIndex < content.length) {
    parts.push(content.slice(lastIndex));
  }
  return parts;
}

/**
 * Render ANSI segments with search highlight overlay.
 *
 * Search match offsets are relative to the stripped plain text. We walk through
 * segments (whose concatenated .text equals the plain text) and split them at
 * highlight boundaries, layering highlight styles on top of ANSI styles.
 */
function renderAnsiWithSearch(
  segments: AnsiSegment[],
  matches: SearchMatch[],
  currentMatchOffset: number,
  scrollToMatchRef: (node: HTMLSpanElement | null) => void,
): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  let matchIdx = 0;
  let globalOffset = 0; // current position in the plain text
  let key = 0;

  for (const seg of segments) {
    const baseStyle = ansiStyle(seg);
    let segPos = 0; // position within this segment's text

    while (segPos < seg.text.length) {
      // If no more matches, emit the rest of this segment with its ANSI style.
      if (matchIdx >= matches.length) {
        const text = seg.text.substring(segPos);
        parts.push(baseStyle ? <span key={key++} style={baseStyle}>{text}</span> : text);
        segPos = seg.text.length;
        break;
      }

      const match = matches[matchIdx];
      const matchStart = match.startOffset;
      const matchEnd = match.endOffset;
      const absPos = globalOffset + segPos;

      // Before the next match: emit un-highlighted text.
      if (absPos < matchStart) {
        const take = Math.min(matchStart - absPos, seg.text.length - segPos);
        const text = seg.text.substring(segPos, segPos + take);
        parts.push(baseStyle ? <span key={key++} style={baseStyle}>{text}</span> : text);
        segPos += take;
        continue;
      }

      // Inside a match: emit highlighted text.
      if (absPos < matchEnd) {
        const take = Math.min(matchEnd - absPos, seg.text.length - segPos);
        const text = seg.text.substring(segPos, segPos + take);
        const isCurrent = match.startOffset === currentMatchOffset;
        const hlStyle: React.CSSProperties = {
          ...baseStyle,
          backgroundColor: isCurrent ? '#ff9800' : '#ffeb3b',
          color: '#000',
          borderRadius: 2,
        };
        parts.push(
          <span
            key={key++}
            ref={isCurrent && absPos === matchStart ? scrollToMatchRef : undefined}
            style={hlStyle}
          >
            {text}
          </span>,
        );
        segPos += take;

        // If we've reached the end of this match, advance to the next.
        if (globalOffset + segPos >= matchEnd) {
          matchIdx++;
        }
        continue;
      }

      // Past this match (shouldn't normally happen, but be safe).
      matchIdx++;
    }

    globalOffset += seg.text.length;
  }

  return parts;
}

const LogEntryComponent: React.FC<Props> = ({
  entry,
  showTimestamps,
  showSources,
  showLineNumbers,
  wrap,
  colorize,
  searchMatches,
  currentMatchOffset = -1,
}) => {
  const levelColor = entry.level ? LEVEL_COLORS[entry.level] : undefined;

  const scrollToMatchRef = React.useCallback((node: HTMLSpanElement | null) => {
    if (node) {
      requestAnimationFrame(() => {
        node.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      });
    }
  }, []);

  const renderContent = () => {
    const segments = colorize ? entry.ansiSegments : undefined;
    const hasSearch = searchMatches && searchMatches.length > 0;

    // Fast path: no ANSI, no search → plain text.
    if (!segments && !hasSearch) {
      return entry.content;
    }

    // No ANSI segments → plain text with search highlights (original path).
    if (!segments && hasSearch) {
      return renderSearchHighlights(entry.content, searchMatches!, currentMatchOffset, scrollToMatchRef);
    }

    // ANSI segments present, no search → styled spans.
    if (segments && !hasSearch) {
      return renderAnsiSegments(segments);
    }

    // Both ANSI segments and search → overlay highlights onto styled segments.
    return renderAnsiWithSearch(segments!, searchMatches!, currentMatchOffset, scrollToMatchRef);
  };

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 0.5,
        px: 1,
        py: '1px',
        fontFamily: 'monospace',
        fontSize: '12px',
        lineHeight: '18px',
        borderLeft: levelColor ? `3px solid ${levelColor}` : '3px solid transparent',
        '&:hover': { bgcolor: 'background.level1' },
        ...(entry.origin === 'SYSTEM' && {
          bgcolor: 'background.level2',
          fontStyle: 'italic',
          color: 'text.tertiary',
        }),
      }}
    >
      {/* Line number */}
      {showLineNumbers && (
        <Text
          sx={{
            minWidth: '4ch',
            textAlign: 'right',
            color: 'text.disabled',
            userSelect: 'none',
            flexShrink: 0,
            fontSize: 'inherit',
            fontFamily: 'inherit',
            lineHeight: 'inherit',
          }}
        >
          {entry.lineNumber}
        </Text>
      )}

      {/* Timestamp */}
      {showTimestamps && entry.timestamp && (
        <Text
          sx={{
            color: 'text.secondary',
            userSelect: 'none',
            flexShrink: 0,
            fontSize: 'inherit',
            fontFamily: 'inherit',
            lineHeight: 'inherit',
          }}
        >
          {formatTimestamp(entry.timestamp)}
        </Text>
      )}

      {/* Source badge */}
      {showSources && entry.sourceId && (
        <span
          style={{
            fontSize: '10px',
            lineHeight: '16px',
            height: 16,
            padding: '0 6px',
            borderRadius: 4,
            backgroundColor: SOURCE_COLORS[sourceColorIndex(entry.sourceId)][0],
            color: SOURCE_COLORS[sourceColorIndex(entry.sourceId)][1],
            flexShrink: 0,
            whiteSpace: 'nowrap',
            userSelect: 'none',
            WebkitUserSelect: 'none',
          }}
        >
          {entry.sourceId}
        </span>
      )}

      {/* Content */}
      <Text
        component="span"
        sx={{
          flex: 1,
          fontSize: 'inherit',
          fontFamily: 'inherit',
          lineHeight: 'inherit',
          whiteSpace: wrap ? 'pre-wrap' : 'pre',
          wordBreak: wrap ? 'break-all' : 'normal',
          overflow: wrap ? 'hidden' : 'visible',
        }}
      >
        {renderContent()}
      </Text>
    </Box>
  );
};

export default React.memo(LogEntryComponent, (prev, next) => {
  return (
    prev.entry === next.entry &&
    prev.showTimestamps === next.showTimestamps &&
    prev.showSources === next.showSources &&
    prev.showLineNumbers === next.showLineNumbers &&
    prev.wrap === next.wrap &&
    prev.colorize === next.colorize &&
    prev.searchMatches === next.searchMatches &&
    prev.currentMatchOffset === next.currentMatchOffset
  );
});
