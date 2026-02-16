import React, { useCallback, useRef } from 'react';
import Box from '@mui/joy/Box';
import IconButton from '@mui/joy/IconButton';
import Input from '@mui/joy/Input';
import Tooltip from '@mui/joy/Tooltip';
import Typography from '@mui/joy/Typography';
import Divider from '@mui/joy/Divider';
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
  LuX,
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
  follow: boolean;
  onToggleFollow: () => void;
  paused: boolean;
  onTogglePaused: () => void;
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
  follow,
  onToggleFollow,
  paused,
  onTogglePaused,
  onDownload,
  onClear,
  filterSelectors,
  jumpToTime,
  lineCount,
}) => {
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
      <Input
        size="sm"
        placeholder="Search in logs"
        autoComplete="off"
        value={searchQuery}
        onChange={(e) => onSearchChange(e.target.value)}
        startDecorator={<LuSearch size={14} />}
        endDecorator={
          <>
            {matchCount > 0 ? (
              <Typography level="body-xs" sx={{ color: 'text.tertiary' }}>
                {currentMatch + 1}/{matchCount.toLocaleString()}{matchCapped ? '+' : ''}
              </Typography>
            ) : searchQuery ? (
              <Typography level="body-xs" sx={{ color: 'text.tertiary' }}>
                0/0
              </Typography>
            ) : null}
            {searchQuery && (
              <IconButton
                size="sm"
                variant="plain"
                color="neutral"
                onClick={() => onSearchChange('')}
                sx={{ '--IconButton-size': '20px', minWidth: 0, minHeight: 0 }}
              >
                <LuX size={12} />
              </IconButton>
            )}
          </>
        }
        slotProps={{
          input: {
            autoCorrect: 'off',
            autoComplete: 'off',
          },
        }}
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

      <Tooltip title="Case sensitive">
        <IconButton
          size="sm"
          variant={caseSensitive ? 'soft' : 'plain'}
          color={caseSensitive ? 'primary' : 'neutral'}
          onClick={onToggleCaseSensitive}
        >
          <LuCaseSensitive size={14} />
        </IconButton>
      </Tooltip>

      <Tooltip title="Regex">
        <IconButton
          size="sm"
          variant={isRegex ? 'soft' : 'plain'}
          color={isRegex ? 'primary' : 'neutral'}
          onClick={onToggleRegex}
        >
          <LuRegex size={14} />
        </IconButton>
      </Tooltip>

      <IconButton size="sm" variant="plain" disabled={matchCount === 0} {...prevHold}>
        <LuChevronUp size={14} />
      </IconButton>
      <IconButton size="sm" variant="plain" disabled={matchCount === 0} {...nextHold}>
        <LuChevronDown size={14} />
      </IconButton>

      <Divider orientation="vertical" sx={{ mx: 0.5 }} />

      {/* Filter selectors */}
      {filterSelectors}

      {/* Controls */}
      <Tooltip title="Timestamps">
        <IconButton
          size="sm"
          variant={showTimestamps ? 'soft' : 'plain'}
          color={showTimestamps ? 'primary' : 'neutral'}
          onClick={onToggleTimestamps}
        >
          <LuClock size={14} />
        </IconButton>
      </Tooltip>

      <Tooltip title="Source badges">
        <IconButton
          size="sm"
          variant={showSources ? 'soft' : 'plain'}
          color={showSources ? 'primary' : 'neutral'}
          onClick={onToggleSources}
        >
          <LuTag size={14} />
        </IconButton>
      </Tooltip>

      <Tooltip title="Line numbers">
        <IconButton
          size="sm"
          variant={showLineNumbers ? 'soft' : 'plain'}
          color={showLineNumbers ? 'primary' : 'neutral'}
          onClick={onToggleLineNumbers}
        >
          <LuHash size={14} />
        </IconButton>
      </Tooltip>

      <Tooltip title="Word wrap">
        <IconButton
          size="sm"
          variant={wrap ? 'soft' : 'plain'}
          color={wrap ? 'primary' : 'neutral'}
          onClick={onToggleWrap}
        >
          <LuWrapText size={14} />
        </IconButton>
      </Tooltip>

      <Tooltip title={follow ? 'Following' : 'Follow output'}>
        <IconButton
          size="sm"
          variant={follow ? 'soft' : 'plain'}
          color={follow ? 'primary' : 'neutral'}
          onClick={onToggleFollow}
        >
          <LuArrowDownToLine size={14} />
        </IconButton>
      </Tooltip>

      {jumpToTime}

      <Tooltip title={paused ? 'Resume' : 'Pause'}>
        <IconButton
          size="sm"
          variant={paused ? 'soft' : 'plain'}
          color={paused ? 'warning' : 'neutral'}
          onClick={onTogglePaused}
        >
          {paused ? <LuPlay size={14} /> : <LuPause size={14} />}
        </IconButton>
      </Tooltip>

      <Divider orientation="vertical" sx={{ mx: 0.5 }} />

      <Tooltip title="Download">
        <IconButton size="sm" variant="plain" onClick={onDownload}>
          <LuDownload size={14} />
        </IconButton>
      </Tooltip>

      <Tooltip title="Clear">
        <IconButton size="sm" variant="plain" onClick={onClear}>
          <LuTrash2 size={14} />
        </IconButton>
      </Tooltip>

      {/* Status */}
      <Box sx={{ flex: 1 }} />
      <Typography level="body-xs" sx={{ color: 'text.tertiary', mr: 1 }}>
        {lineCount.toLocaleString()} lines
      </Typography>
    </Box>
  );
};

export default React.memo(LogViewerToolbar);
