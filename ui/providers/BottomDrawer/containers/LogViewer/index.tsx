import React, { useCallback, useMemo, useRef, useState } from 'react';
import Box from '@mui/joy/Box';
import Button from '@mui/joy/Button';
import Typography from '@mui/joy/Typography';
import { useVirtualizer } from '@tanstack/react-virtual';
import CircularProgress from '@mui/joy/CircularProgress';
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
  const [follow, setFollow] = useState(true);
  const [paused, setPaused] = useState(false);
  const [events, setEvents] = useState<LogStreamEvent[]>([]);
  const [openFilterKey, setOpenFilterKey] = useState<string | null>(null);

  // Track programmatic scrolls so scroll handler doesn't disengage follow
  const isAutoScrolling = useRef(false);

  const { entries, version, append, clear: clearBuffer, lineCount } = useLogBuffer();

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

  const search = useLogSearch({ entries: filteredEntries, version });

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

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        overflow: 'hidden',
        position: 'relative',
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
          <Typography level="body-xs" sx={{ color: 'warning.plainColor' }}>
            {latestError?.message}
            {streamErrors.length > 1 && ` (+${streamErrors.length - 1} more)`}
          </Typography>
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
            bgcolor: 'background.body',
            minHeight: 0,
          }}
        >
          <LuTriangleAlert size={32} color="var(--joy-palette-danger-400)" />
          <Typography level="title-md" sx={{ color: 'danger.plainColor' }}>
            Failed to stream logs
          </Typography>
          {streamErrors.map((err, i) => (
            <Typography
              key={i}
              level="body-sm"
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
            </Typography>
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
            bgcolor: 'background.body',
            minHeight: 0,
          }}
        >
          <CircularProgress size="md" variant="soft" color="neutral" />
          <Typography level="body-sm" sx={{ color: 'text.tertiary' }}>
            Connecting to log sources...
          </Typography>
          {sourceState.sources.length > 0 && (
            <Typography level="body-xs" sx={{ color: 'text.tertiary' }}>
              {sourceState.sources.length} source{sourceState.sources.length !== 1 ? 's' : ''} found, waiting for data
            </Typography>
          )}
        </Box>
      ) : (
        /* Virtual log list */
        <Box
          ref={parentRef}
          onScroll={handleScroll}
          sx={{
            flex: 1,
            minHeight: 0,
            overflow: 'auto',
            bgcolor: 'background.body',
            whiteSpace: wrap ? 'normal' : 'pre',
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
          variant="soft"
          color="neutral"
          startDecorator={<LuArrowDown size={14} />}
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
