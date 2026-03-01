import React, { useCallback, useMemo, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Button } from '@omniviewdev/ui/buttons';
import { Text } from '@omniviewdev/ui/typography';
import { LuArrowDown, LuTriangleAlert } from 'react-icons/lu';

import LogEntryComponent from './LogEntry';
import LogViewerToolbar from './LogViewerToolbar';
import FilterSelect from './FilterSelect';
import JumpToTime from './JumpToTime';
import { useLogBuffer } from './hooks/useLogBuffer';
import { useLogStream } from './hooks/useLogStream';
import { useLogSearch } from './hooks/useLogSearch';
import { useLogSources } from './hooks/useLogSources';
import { saveLogsNative } from './utils/downloadLogs';
import { findEntryIndexByTime } from './utils/binarySearchTimestamp';
import type { LogEntry, LogStreamEvent, SearchMatch } from './types';
import { StreamEventType } from './types';

interface Props {
  sessionId: string;
}

const LogViewerContainer: React.FC<Props> = ({ sessionId }) => {
  const parentRef = useRef<HTMLDivElement>(null);
  const [showTimestamps, setShowTimestamps] = useState(true);
  const [showSources, setShowSources] = useState(true);
  const [showLineNumbers, setShowLineNumbers] = useState(false);
  const [wrap, setWrap] = useState(false);
  const [colorize, setColorize] = useState(true);
  const [follow, setFollow] = useState(true);
  const [paused, setPaused] = useState(false);
  const [events, setEvents] = useState<LogStreamEvent[]>([]);
  const [openFilterKey, setOpenFilterKey] = useState<string | null>(null);

  // Track programmatic scrolls so scroll handler doesn't disengage follow
  const isAutoScrolling = useRef(false);

  const { entries, version, append, clear: clearBuffer, lineCount, evictionCount } = useLogBuffer();

  const handleClear = useCallback(() => {
    clearBuffer();
  }, [clearBuffer]);

  // Source selection (multi-select filtering)
  const sourceState = useLogSources({ sessionId, events, entries, version });

  // Filter entries by selected sources
  const filteredEntries = useMemo(() => {
    if (sourceState.allSelected || sourceState.sources.length <= 1) return entries;
    return entries.filter((e) => sourceState.selectedSourceIds.has(e.sourceId));
  }, [entries, version, sourceState.selectedSourceIds, sourceState.allSelected, sourceState.sources.length]);

  const filteredLineCount = filteredEntries.length;

  const search = useLogSearch({ entries: filteredEntries, version, evictionCount });

  const handleLines = useCallback(
    (newEntries: LogEntry[]) => {
      append(newEntries);
    },
    [append],
  );

  const handleEvent = useCallback((event: LogStreamEvent) => {
    setEvents((prev) => [...prev.slice(-99), event]);
  }, []);

  useLogStream({
    sessionId,
    onLines: handleLines,
    onEvent: handleEvent,
    paused,
  });

  // Virtual list
  const rowVirtualizer = useVirtualizer({
    count: filteredLineCount,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 18,
    overscan: 30,
  });

  // Auto-scroll when following
  React.useEffect(() => {
    if (follow && filteredLineCount > 0) {
      isAutoScrolling.current = true;
      rowVirtualizer.scrollToIndex(filteredLineCount - 1, { align: 'end' });
      // Allow the scroll event to settle before re-enabling detection
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          isAutoScrolling.current = false;
        });
      });
    }
  }, [follow, filteredLineCount, version]);

  // Detect scroll position to engage/disengage follow
  const handleScroll = useCallback(() => {
    if (!parentRef.current || isAutoScrolling.current) return;
    const el = parentRef.current;
    const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
    if (isAtBottom && !follow) {
      setFollow(true);
    } else if (!isAtBottom && follow) {
      setFollow(false);
    }
  }, [follow]);

  const jumpToBottom = useCallback(() => {
    setFollow(true);
    isAutoScrolling.current = true;
    rowVirtualizer.scrollToIndex(filteredLineCount - 1, { align: 'end' });
    requestAnimationFrame(() => {
      isAutoScrolling.current = false;
    });
  }, [filteredLineCount, rowVirtualizer]);

  const jumpToTime = useCallback((target: Date) => {
    const idx = findEntryIndexByTime(filteredEntries, target);
    if (idx >= 0) {
      setFollow(false);
      rowVirtualizer.scrollToIndex(idx, { align: 'start' });
    }
  }, [filteredEntries, rowVirtualizer]);

  // Build per-line search match index
  const matchesByLine = useMemo(() => {
    const map = new Map<number, SearchMatch[]>();
    for (const match of search.matches) {
      const existing = map.get(match.lineIndex) || [];
      existing.push(match);
      map.set(match.lineIndex, existing);
    }
    return map;
  }, [search.matches]);

  const currentMatch = search.matches.length > 0 ? search.matches[search.currentMatchIndex] : null;
  const currentMatchLine = currentMatch?.lineIndex ?? -1;
  const currentMatchOffset = currentMatch?.startOffset ?? -1;

  // Scroll to current match
  React.useEffect(() => {
    if (currentMatchLine >= 0) {
      rowVirtualizer.scrollToIndex(currentMatchLine, { align: 'center' });
    }
  }, [search.currentMatchIndex, currentMatchLine]);

  // Derive error state from events
  const streamErrors = useMemo(
    () => events.filter((e) => e.type === StreamEventType.STREAM_ERROR),
    [events],
  );
  const hasErrors = streamErrors.length > 0;
  const latestError = hasErrors ? streamErrors[streamErrors.length - 1] : null;

  const virtualItems = rowVirtualizer.getVirtualItems();
  const paddingTop = virtualItems.length > 0 ? virtualItems[0].start : 0;
  const paddingBottom = virtualItems.length > 0
    ? rowVirtualizer.getTotalSize() - virtualItems[virtualItems.length - 1].end
    : 0;

  // Scope Cmd+A / Ctrl+A to the log scroll area only
  const handleLogKeyDown = useCallback((e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'a') {
      e.preventDefault();
      const el = parentRef.current;
      if (!el) return;
      const sel = window.getSelection();
      if (!sel) return;
      const range = document.createRange();
      range.selectNodeContents(el);
      sel.removeAllRanges();
      sel.addRange(range);
    }
  }, []);

  // Contain drag selections: disable pointer-events on siblings while dragging
  // so the selection cannot escape the log scroll area into the toolbar/input.
  const handleLogMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const logEl = parentRef.current;
    const container = logEl?.parentElement;
    if (!logEl || !container) return;

    const saved: [HTMLElement, string][] = [];
    for (const child of container.children) {
      if (child !== logEl && child instanceof HTMLElement) {
        saved.push([child, child.style.pointerEvents]);
        child.style.pointerEvents = 'none';
      }
    }

    const restore = () => {
      for (const [el, prev] of saved) {
        el.style.pointerEvents = prev;
      }
      document.removeEventListener('mouseup', restore);
      window.removeEventListener('blur', restore);
    };
    document.addEventListener('mouseup', restore, { once: true });
    window.addEventListener('blur', restore, { once: true });
  }, []);

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        overflow: 'hidden',
        position: 'relative',
        userSelect: 'none',
      }}
    >
      <LogViewerToolbar
        searchQuery={search.query}
        onSearchChange={search.setQuery}
        isRegex={search.isRegex}
        onToggleRegex={() => search.setIsRegex(!search.isRegex)}
        caseSensitive={search.caseSensitive}
        onToggleCaseSensitive={() => search.setCaseSensitive(!search.caseSensitive)}
        matchCount={search.totalMatches}
        currentMatch={search.currentMatchIndex}
        matchCapped={search.capped}
        onNextMatch={search.nextMatch}
        onPrevMatch={search.prevMatch}
        showTimestamps={showTimestamps}
        onToggleTimestamps={() => setShowTimestamps(!showTimestamps)}
        showSources={showSources}
        onToggleSources={() => setShowSources(!showSources)}
        showLineNumbers={showLineNumbers}
        onToggleLineNumbers={() => setShowLineNumbers(!showLineNumbers)}
        wrap={wrap}
        onToggleWrap={() => setWrap(!wrap)}
        colorize={colorize}
        onToggleColorize={() => setColorize(!colorize)}
        follow={follow}
        onToggleFollow={() => setFollow(!follow)}
        paused={paused}
        onTogglePaused={() => setPaused(!paused)}
        onDownload={() => saveLogsNative(filteredEntries)}
        onClear={handleClear}
        lineCount={lineCount}
        filterSelectors={
          sourceState.dimensions
            .filter((d) => d.values.length > 0)
            .map((d) => (
              <FilterSelect
                key={d.key}
                label={d.displayName}
                items={d.values}
                selectedItems={d.selectedValues}
                allSelected={d.allSelected}
                onToggleItem={(v) => sourceState.toggleValue(d.key, v)}
                onToggleAll={() => sourceState.toggleAll(d.key)}
                isOpen={openFilterKey === d.key}
                onOpenChange={(open) => setOpenFilterKey(open ? d.key : null)}
              />
            ))
        }
        jumpToTime={<JumpToTime onJumpToTime={jumpToTime} />}
      />

      {/* Error banner when logs are flowing but errors occurred */}
      {hasErrors && filteredLineCount > 0 && (
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            px: 1.5,
            py: 0.5,
            bgcolor: 'warning.softBg',
            borderBottom: '1px solid',
            borderColor: 'warning.outlinedBorder',
            flexShrink: 0,
          }}
        >
          <LuTriangleAlert size={14} />
          <Text variant="caption" size="xs" sx={{ color: 'warning.main' }}>
            {latestError?.message}
            {streamErrors.length > 1 && ` (+${streamErrors.length - 1} more)`}
          </Text>
        </Box>
      )}

      {/* Empty error state -- no logs and errors present */}
      {hasErrors && filteredLineCount === 0 ? (
        <Box
          sx={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 1.5,
            p: 4,
            bgcolor: 'black',
            minHeight: 0,
          }}
        >
          <LuTriangleAlert size={32} color="var(--palette-error-main)" />
          <Text weight="semibold" sx={{ color: 'error.main' }}>
            Failed to stream logs
          </Text>
          {streamErrors.map((err, i) => (
            <Text
              key={i}
              size="sm"
              sx={{
                color: 'text.secondary',
                fontFamily: 'monospace',
                fontSize: '12px',
                maxWidth: 600,
                textAlign: 'center',
              }}
            >
              {err.source_id && <><strong>{err.source_id}:</strong>{' '}</>}
              {err.message}
            </Text>
          ))}
        </Box>
      ) : !hasErrors && filteredLineCount === 0 ? (
        /* Loading state — waiting for log data */
        <Box
          sx={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 1.5,
            p: 4,
            bgcolor: 'black',
            minHeight: 0,
          }}
        >
          <CircularProgress size={32} color="inherit" />
          <Text size="sm" sx={{ color: 'text.disabled' }}>
            Connecting to log sources...
          </Text>
          {sourceState.sources.length > 0 && (
            <Text variant="caption" size="xs" sx={{ color: 'text.disabled' }}>
              {sourceState.sources.length} source{sourceState.sources.length !== 1 ? 's' : ''} found, waiting for data
            </Text>
          )}
        </Box>
      ) : (
        /* Virtual log list */
        <Box
          ref={parentRef}
          onScroll={handleScroll}
          onKeyDown={handleLogKeyDown}
          onMouseDown={handleLogMouseDown}
          tabIndex={0}
          sx={{
            flex: 1,
            minHeight: 0,
            overflow: 'auto',
            bgcolor: 'black',
            whiteSpace: wrap ? 'normal' : 'pre',
            userSelect: 'text',
            outline: 'none',
            '&:focus-visible': {
              outline: '2px solid',
              outlineColor: 'primary.outlinedBorder',
              outlineOffset: -2,
            },
          }}
        >
          <Box sx={{ paddingTop: `${paddingTop}px`, paddingBottom: `${paddingBottom}px` }}>
            {virtualItems.map((virtualRow) => {
              const entry = filteredEntries[virtualRow.index];
              if (!entry) return null;

              return (
                <Box
                  key={virtualRow.key}
                  data-index={virtualRow.index}
                  ref={rowVirtualizer.measureElement}
                  sx={{
                    minWidth: '100%',
                    width: wrap ? '100%' : 'max-content',
                  }}
                >
                  <LogEntryComponent
                    entry={entry}
                    showTimestamps={showTimestamps}
                    showSources={showSources}
                    showLineNumbers={showLineNumbers}
                    wrap={wrap}
                    colorize={colorize}
                    searchMatches={matchesByLine.get(virtualRow.index)}
                    currentMatchOffset={virtualRow.index === currentMatchLine ? currentMatchOffset : -1}
                  />
                </Box>
              );
            })}
          </Box>
        </Box>
      )}

      {/* Jump to bottom FAB */}
      {!follow && filteredLineCount > 0 && (
        <Button
          size="sm"
          emphasis="soft"
          color="neutral"
          startAdornment={<LuArrowDown size={14} />}
          onClick={jumpToBottom}
          sx={{
            position: 'absolute',
            bottom: 16,
            right: 16,
            zIndex: 10,
          }}
        >
          Jump to bottom
        </Button>
      )}
    </Box>
  );
};

export default React.memo(LogViewerContainer, (prev, next) => {
  return prev.sessionId === next.sessionId;
});
