import React, { useCallback, useRef } from 'react';
import { IconButton, SearchInput, Separator, Text, type ComponentColor } from '@omniviewdev/base-ui';
import HintTooltip from '@/components/base/HintTooltip';
import styles from './LogViewerToolbar.module.css';
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
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current); timeoutRef.current = null; 
    }

    if (intervalRef.current) {
      clearInterval(intervalRef.current); intervalRef.current = null; 
    }
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

type Props = {
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

  // Injection slots
  /** Elements rendered at the start of the toolbar (before search input) */
  toolbarPrefix?: React.ReactNode;
  /** Elements rendered after the follow button, before copy section */
  toolbarActions?: React.ReactNode;

  // Status
  lineCount: number;
};

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
  toolbarPrefix,
  toolbarActions,
  lineCount,
}) => {
  const isMac = typeof navigator !== 'undefined' && /mac/i.test(navigator.userAgent);
  const prevHold = useHoldRepeat(onPrevMatch);
  const nextHold = useHoldRepeat(onNextMatch);

  return (
    <div className={styles.Toolbar}>
      {/* Prefix slot (e.g., status chip for dev build) */}
      {toolbarPrefix}
      {toolbarPrefix && <Separator orientation='vertical' className={styles.Separator} />}

      {/* Search */}
      <SearchInput
        size='sm'
        placeholder='Search in logs'
        autoFocus
        autoComplete='off'
        data-search-input
        className={styles.Search}
        value={searchQuery}
        onValueChange={onSearchChange}
        startDecorator={<LuSearch size={12} />}
        clearDecorator={<LuX size={10} />}
        endDecorator={
          matchCount > 0 ? (
            <Text size='xs' tone='subtle'>
              {currentMatch + 1}/{matchCount.toLocaleString()}{matchCapped ? '+' : ''}
            </Text>
          ) : searchQuery ? (
            <Text size='xs' tone='subtle'>0/0</Text>
          ) : undefined
        }
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            if (e.shiftKey) {
              onPrevMatch();
            } else {
              onNextMatch();
            }
          }

          if (e.key === 'Escape') {
            onSearchChange('');
          }
        }}
      />

      <ToggleButton label='Case sensitive' active={caseSensitive} onClick={onToggleCaseSensitive}>
        <LuCaseSensitive size={12} />
      </ToggleButton>

      <ToggleButton label='Regex' active={isRegex} onClick={onToggleRegex}>
        <LuRegex size={12} />
      </ToggleButton>

      <IconButton size='xs' variant='ghost' color='neutral' aria-label='Previous match' disabled={matchCount === 0} {...prevHold}>
        <LuChevronUp size={12} />
      </IconButton>
      <IconButton size='xs' variant='ghost' color='neutral' aria-label='Next match' disabled={matchCount === 0} {...nextHold}>
        <LuChevronDown size={12} />
      </IconButton>

      <Separator orientation='vertical' className={styles.Separator} />

      {/* Filter selectors */}
      {filterSelectors}

      {/* Controls */}
      <ToggleButton label='Timestamps' active={showTimestamps} onClick={onToggleTimestamps}>
        <LuClock size={12} />
      </ToggleButton>

      <ToggleButton label='Source badges' active={showSources} onClick={onToggleSources}>
        <LuTag size={12} />
      </ToggleButton>

      <ToggleButton label='Line numbers' active={showLineNumbers} onClick={onToggleLineNumbers}>
        <LuHash size={12} />
      </ToggleButton>

      <ToggleButton label='Word wrap' active={wrap} onClick={onToggleWrap}>
        <LuWrapText size={12} />
      </ToggleButton>

      <ToggleButton
        label={colorize ? 'ANSI colors on' : 'ANSI colors off'}
        ariaLabel='Toggle ANSI colors'
        pressed
        active={colorize}
        onClick={onToggleColorize}
      >
        <LuPalette size={12} />
      </ToggleButton>

      <ToggleButton label={follow ? 'Following' : 'Follow output'} active={follow} onClick={onToggleFollow}>
        <LuArrowDownToLine size={12} />
      </ToggleButton>

      {jumpToTime}

      {/* Custom actions slot (e.g., restart/rebuild for dev build) */}
      {toolbarActions}

      <ToggleButton label={paused ? 'Resume' : 'Pause'} active={paused} activeColor='warning' onClick={onTogglePaused}>
        {paused ? <LuPlay size={12} /> : <LuPause size={12} />}
      </ToggleButton>

      <Separator orientation='vertical' className={styles.Separator} />

      <ToggleButton
        label={copyFeedback === 'visible' ? 'Copied!' : `Copy visible lines (${isMac ? '⌘⇧V' : 'Ctrl+Shift+V'})`}
        ariaLabel='Copy visible lines'
        active={copyFeedback === 'visible'}
        activeColor='success'
        onClick={onCopyVisible}
      >
        {copyFeedback === 'visible' ? <LuClipboardCheck size={12} /> : <LuCopy size={12} />}
      </ToggleButton>

      <ToggleButton
        label={copyFeedback === 'all' ? 'Copied!' : `Copy all lines (${isMac ? '⌘⇧C' : 'Ctrl+Shift+C'})`}
        ariaLabel='Copy all lines'
        active={copyFeedback === 'all'}
        activeColor='success'
        onClick={onCopyAll}
      >
        {copyFeedback === 'all' ? <LuClipboardCheck size={12} /> : <LuClipboard size={12} />}
      </ToggleButton>

      <ToggleButton label='Download' onClick={onDownload}>
        <LuDownload size={12} />
      </ToggleButton>

      <ToggleButton label='Clear' onClick={onClear}>
        <LuTrash2 size={12} />
      </ToggleButton>

      {/* Status */}
      <span className={styles.Spacer} />
      <Text size='xs' tone='subtle' className={styles.LineCount}>
        {lineCount.toLocaleString()} lines
      </Text>
    </div>
  );
};

/** Toolbar icon button with a tooltip; soft and colored while `active`. */
const ToggleButton: React.FC<{
  label: string;
  ariaLabel?: string;
  /** Expose `active` as aria-pressed. */
  pressed?: boolean;
  active?: boolean;
  activeColor?: ComponentColor;
  onClick: () => void;
  children: React.ReactNode;
}> = ({ label, ariaLabel, pressed = false, active = false, activeColor = 'brand', onClick, children }) => (
  <HintTooltip content={label}>
    <IconButton
      size='xs'
      variant={active ? 'soft' : 'ghost'}
      color={active ? activeColor : 'neutral'}
      aria-label={ariaLabel ?? label}
      aria-pressed={pressed ? active : undefined}
      onClick={onClick}
    >
      {children}
    </IconButton>
  </HintTooltip>
);

export default React.memo(LogViewerToolbar);
