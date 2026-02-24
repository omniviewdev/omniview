import React from 'react';
import Box from '@mui/material/Box';
import { Text } from '@omniviewdev/ui/typography';
import type { LogEntry as LogEntryType, SearchMatch } from './types';
import { LEVEL_COLORS } from './types';

interface Props {
  entry: LogEntryType;
  showTimestamps: boolean;
  showSources: boolean;
  showLineNumbers: boolean;
  wrap: boolean;
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

const LogEntryComponent: React.FC<Props> = ({
  entry,
  showTimestamps,
  showSources,
  showLineNumbers,
  wrap,
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
    if (!searchMatches || searchMatches.length === 0) {
      return entry.content;
    }

    // Highlight search matches — only the current match gets orange
    const parts: React.ReactNode[] = [];
    let lastIndex = 0;

    for (const match of searchMatches) {
      if (match.startOffset > lastIndex) {
        parts.push(entry.content.slice(lastIndex, match.startOffset));
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
          {entry.content.slice(match.startOffset, match.endOffset)}
        </span>,
      );
      lastIndex = match.endOffset;
    }

    if (lastIndex < entry.content.length) {
      parts.push(entry.content.slice(lastIndex));
    }

    return parts;
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
    prev.entry.lineNumber === next.entry.lineNumber &&
    prev.showTimestamps === next.showTimestamps &&
    prev.showSources === next.showSources &&
    prev.showLineNumbers === next.showLineNumbers &&
    prev.wrap === next.wrap &&
    prev.searchMatches === next.searchMatches &&
    prev.currentMatchOffset === next.currentMatchOffset
  );
});
