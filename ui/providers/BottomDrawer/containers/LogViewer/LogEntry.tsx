import React from 'react';
import Box from '@mui/joy/Box';
import Chip from '@mui/joy/Chip';
import Typography from '@mui/joy/Typography';
import type { LogEntry as LogEntryType, SearchMatch } from './types';
import { LEVEL_COLORS } from './types';

interface Props {
  entry: LogEntryType;
  showTimestamps: boolean;
  showSources: boolean;
  wrap: boolean;
  searchMatches?: SearchMatch[];
  isCurrentMatch?: boolean;
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
  wrap,
  searchMatches,
  isCurrentMatch,
}) => {
  const levelColor = entry.level ? LEVEL_COLORS[entry.level] : undefined;

  const renderContent = () => {
    if (!searchMatches || searchMatches.length === 0) {
      return entry.content;
    }

    // Highlight search matches
    const parts: React.ReactNode[] = [];
    let lastIndex = 0;

    for (const match of searchMatches) {
      if (match.startOffset > lastIndex) {
        parts.push(entry.content.slice(lastIndex, match.startOffset));
      }
      parts.push(
        <span
          key={match.startOffset}
          style={{
            backgroundColor: isCurrentMatch ? '#ff9800' : '#ffeb3b',
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
      <Typography
        sx={{
          minWidth: '4ch',
          textAlign: 'right',
          color: 'text.tertiary',
          userSelect: 'none',
          flexShrink: 0,
          fontSize: 'inherit',
          fontFamily: 'inherit',
          lineHeight: 'inherit',
        }}
      >
        {entry.lineNumber}
      </Typography>

      {/* Timestamp */}
      {showTimestamps && entry.timestamp && (
        <Typography
          sx={{
            color: 'text.secondary',
            flexShrink: 0,
            fontSize: 'inherit',
            fontFamily: 'inherit',
            lineHeight: 'inherit',
          }}
        >
          {formatTimestamp(entry.timestamp)}
        </Typography>
      )}

      {/* Source badges */}
      {showSources && entry.sourceId && (
        <Chip
          size="sm"
          variant="soft"
          color="primary"
          sx={{
            fontSize: '10px',
            height: '16px',
            flexShrink: 0,
          }}
        >
          {entry.sourceId}
        </Chip>
      )}

      {/* Content */}
      <Typography
        component="span"
        sx={{
          flex: 1,
          fontSize: 'inherit',
          fontFamily: 'inherit',
          lineHeight: 'inherit',
          whiteSpace: wrap ? 'pre-wrap' : 'pre',
          wordBreak: wrap ? 'break-all' : 'normal',
          overflow: 'hidden',
        }}
      >
        {renderContent()}
      </Typography>
    </Box>
  );
};

export default React.memo(LogEntryComponent, (prev, next) => {
  return (
    prev.entry.lineNumber === next.entry.lineNumber &&
    prev.showTimestamps === next.showTimestamps &&
    prev.showSources === next.showSources &&
    prev.wrap === next.wrap &&
    prev.searchMatches === next.searchMatches &&
    prev.isCurrentMatch === next.isCurrentMatch
  );
});
