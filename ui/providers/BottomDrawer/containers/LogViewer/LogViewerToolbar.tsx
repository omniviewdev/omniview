import React, { useCallback, useRef } from 'react';
import Box from '@mui/material/Box';
import Divider from '@mui/material/Divider';
import { IconButton } from '@omniviewdev/ui/buttons';
import { TextField } from '@omniviewdev/ui/inputs';
import { Tooltip } from '@omniviewdev/ui/overlays';
import { Text } from '@omniviewdev/ui/typography';
import {
  LuSearch,
  LuCaseSensitive,
  LuRegex,
  LuChevronUp,
  LuChevronDown,
  LuClock,
  LuTag,
  LuHash,
  LuWrapText,
  LuArrowDownToLine,
  LuDownload,
  LuTrash2,
  LuPause,
  LuPlay,
  LuPalette,
  LuX,
  LuCopy,
  LuClipboardCheck,
  LuClipboard,
} from 'react-icons/lu';

/** Fires `action` on click, then repeats while held (accelerating). */
function useHoldRepeat(action: () => void) {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stop = useCallback(() => {
    if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null; }
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
  }, []);

  const start = useCallback(() => {
    action();
    // After initial delay, start repeating
    timeoutRef.current = setTimeout(() => {
      intervalRef.current = setInterval(action, 50);
    }, 300);
  }, [action]);

  return { onMouseDown: start, onMouseUp: stop, onMouseLeave: stop };
}

interface Props {
  // Search
  searchQuery: string;
  onSearchChange: (query: string) => void;
  isRegex: boolean;
  onToggleRegex: () => void;
  caseSensitive: boolean;
  onToggleCaseSensitive: () => void;
  matchCount: number;
  currentMatch: number;
  matchCapped: boolean;
  onNextMatch: () => void;
  onPrevMatch: () => void;

  // Controls
  showTimestamps: boolean;
  onToggleTimestamps: () => void;
  showSources: boolean;
  onToggleSources: () => void;
  showLineNumbers: boolean;
  onToggleLineNumbers: () => void;
  wrap: boolean;
  onToggleWrap: () => void;
  colorize: boolean;
  onToggleColorize: () => void;
  follow: boolean;
  onToggleFollow: () => void;
  paused: boolean;
  onTogglePaused: () => void;
  onCopyVisible: () => void;
  onCopyAll: () => void;
  copyFeedback: 'visible' | 'all' | null;
  onDownload: () => void;
  onClear: () => void;

  // Filter selectors
  filterSelectors?: React.ReactNode;
  // Jump to time
  jumpToTime?: React.ReactNode;

  // Status
  lineCount: number;
}

const LogViewerToolbar: React.FC<Props> = ({
  searchQuery,
  onSearchChange,
  isRegex,
  onToggleRegex,
  caseSensitive,
  onToggleCaseSensitive,
  matchCount,
  currentMatch,
  matchCapped,
  onNextMatch,
  onPrevMatch,
  showTimestamps,
  onToggleTimestamps,
  showSources,
  onToggleSources,
  showLineNumbers,
  onToggleLineNumbers,
  wrap,
  onToggleWrap,
  colorize,
  onToggleColorize,
  follow,
  onToggleFollow,
  paused,
  onTogglePaused,
  onCopyVisible,
  onCopyAll,
  copyFeedback,
  onDownload,
  onClear,
  filterSelectors,
  jumpToTime,
  lineCount,
}) => {
  const isMac = typeof navigator !== 'undefined' && /mac/i.test(navigator.userAgent);
  const prevHold = useHoldRepeat(onPrevMatch);
  const nextHold = useHoldRepeat(onNextMatch);

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 0.5,
        px: 1,
        py: 0.5,
        borderBottom: '1px solid',
        borderColor: 'divider',
        bgcolor: 'background.surface',
        minHeight: 32,
        flexShrink: 0,
      }}
    >
      {/* Search */}
      <TextField
        size="sm"
        placeholder="Search in logs"
        autoFocus
        autoComplete="off"
        value={searchQuery}
        onChange={(value) => onSearchChange(value)}
        startAdornment={<LuSearch size={14} />}
        endAdornment={
          <>
            {matchCount > 0 ? (
              <Text variant="caption" size="xs" sx={{ color: 'text.disabled' }}>
                {currentMatch + 1}/{matchCount.toLocaleString()}{matchCapped ? '+' : ''}
              </Text>
            ) : searchQuery ? (
              <Text variant="caption" size="xs" sx={{ color: 'text.disabled' }}>
                0/0
              </Text>
            ) : null}
            {searchQuery && (
              <IconButton
                size="sm"
                emphasis="ghost"
                color="neutral"
                onClick={() => onSearchChange('')}
                sx={{ minWidth: 0, minHeight: 0, width: 20, height: 20 }}
              >
                <LuX size={12} />
              </IconButton>
            )}
          </>
        }
        sx={{ minWidth: 200, maxWidth: 300, fontSize: '12px' }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.shiftKey ? onPrevMatch() : onNextMatch();
          }
          if (e.key === 'Escape') {
            onSearchChange('');
          }
        }}
      />

      <Tooltip content="Case sensitive">
        <IconButton
          size="sm"
          emphasis={caseSensitive ? 'soft' : 'ghost'}
          color={caseSensitive ? 'primary' : 'neutral'}
          onClick={onToggleCaseSensitive}
        >
          <LuCaseSensitive size={14} />
        </IconButton>
      </Tooltip>

      <Tooltip content="Regex">
        <IconButton
          size="sm"
          emphasis={isRegex ? 'soft' : 'ghost'}
          color={isRegex ? 'primary' : 'neutral'}
          onClick={onToggleRegex}
        >
          <LuRegex size={14} />
        </IconButton>
      </Tooltip>

      <IconButton size="sm" emphasis="ghost" disabled={matchCount === 0} {...prevHold}>
        <LuChevronUp size={14} />
      </IconButton>
      <IconButton size="sm" emphasis="ghost" disabled={matchCount === 0} {...nextHold}>
        <LuChevronDown size={14} />
      </IconButton>

      <Divider orientation="vertical" sx={{ mx: 0.5 }} />

      {/* Filter selectors */}
      {filterSelectors}

      {/* Controls */}
      <Tooltip content="Timestamps">
        <IconButton
          size="sm"
          emphasis={showTimestamps ? 'soft' : 'ghost'}
          color={showTimestamps ? 'primary' : 'neutral'}
          onClick={onToggleTimestamps}
        >
          <LuClock size={14} />
        </IconButton>
      </Tooltip>

      <Tooltip content="Source badges">
        <IconButton
          size="sm"
          emphasis={showSources ? 'soft' : 'ghost'}
          color={showSources ? 'primary' : 'neutral'}
          onClick={onToggleSources}
        >
          <LuTag size={14} />
        </IconButton>
      </Tooltip>

      <Tooltip content="Line numbers">
        <IconButton
          size="sm"
          emphasis={showLineNumbers ? 'soft' : 'ghost'}
          color={showLineNumbers ? 'primary' : 'neutral'}
          onClick={onToggleLineNumbers}
        >
          <LuHash size={14} />
        </IconButton>
      </Tooltip>

      <Tooltip content="Word wrap">
        <IconButton
          size="sm"
          emphasis={wrap ? 'soft' : 'ghost'}
          color={wrap ? 'primary' : 'neutral'}
          onClick={onToggleWrap}
        >
          <LuWrapText size={14} />
        </IconButton>
      </Tooltip>

      <Tooltip content={colorize ? 'ANSI colors on' : 'ANSI colors off'}>
        <IconButton
          size="sm"
          emphasis={colorize ? 'soft' : 'ghost'}
          color={colorize ? 'primary' : 'neutral'}
          onClick={onToggleColorize}
          aria-label="Toggle ANSI colors"
          aria-pressed={colorize}
        >
          <LuPalette size={14} />
        </IconButton>
      </Tooltip>

      <Tooltip content={follow ? 'Following' : 'Follow output'}>
        <IconButton
          size="sm"
          emphasis={follow ? 'soft' : 'ghost'}
          color={follow ? 'primary' : 'neutral'}
          onClick={onToggleFollow}
        >
          <LuArrowDownToLine size={14} />
        </IconButton>
      </Tooltip>

      {jumpToTime}

      <Tooltip content={paused ? 'Resume' : 'Pause'}>
        <IconButton
          size="sm"
          emphasis={paused ? 'soft' : 'ghost'}
          color={paused ? 'warning' : 'neutral'}
          onClick={onTogglePaused}
        >
          {paused ? <LuPlay size={14} /> : <LuPause size={14} />}
        </IconButton>
      </Tooltip>

      <Divider orientation="vertical" sx={{ mx: 0.5 }} />

      <Tooltip content={copyFeedback === 'visible' ? 'Copied!' : `Copy visible lines (${isMac ? '⌘⇧V' : 'Ctrl+Shift+V'})`}>
        <IconButton
          size="sm"
          emphasis={copyFeedback === 'visible' ? 'soft' : 'ghost'}
          color={copyFeedback === 'visible' ? 'success' : 'neutral'}
          onClick={onCopyVisible}
          aria-label="Copy visible lines"
        >
          {copyFeedback === 'visible' ? <LuClipboardCheck size={14} /> : <LuCopy size={14} />}
        </IconButton>
      </Tooltip>

      <Tooltip content={copyFeedback === 'all' ? 'Copied!' : `Copy all lines (${isMac ? '⌘⇧C' : 'Ctrl+Shift+C'})`}>
        <IconButton
          size="sm"
          emphasis={copyFeedback === 'all' ? 'soft' : 'ghost'}
          color={copyFeedback === 'all' ? 'success' : 'neutral'}
          onClick={onCopyAll}
          aria-label="Copy all lines"
        >
          {copyFeedback === 'all' ? <LuClipboardCheck size={14} /> : <LuClipboard size={14} />}
        </IconButton>
      </Tooltip>

      <Tooltip content="Download">
        <IconButton size="sm" emphasis="ghost" onClick={onDownload}>
          <LuDownload size={14} />
        </IconButton>
      </Tooltip>

      <Tooltip content="Clear">
        <IconButton size="sm" emphasis="ghost" onClick={onClear}>
          <LuTrash2 size={14} />
        </IconButton>
      </Tooltip>

      {/* Status */}
      <Box sx={{ flex: 1 }} />
      <Text variant="caption" size="xs" sx={{ color: 'text.disabled', mr: 1 }}>
        {lineCount.toLocaleString()} lines
      </Text>
    </Box>
  );
};

export default React.memo(LogViewerToolbar);
