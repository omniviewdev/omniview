import React, { useCallback, useMemo, useRef, useState } from 'react';
import Box from '@mui/joy/Box';
import Button from '@mui/joy/Button';
import { useVirtualizer } from '@tanstack/react-virtual';
import { LuArrowDown } from 'react-icons/lu';

import LogEntryComponent from './LogEntry';
import LogViewerToolbar from './LogViewerToolbar';
import { useLogBuffer } from './hooks/useLogBuffer';
import { useLogStream } from './hooks/useLogStream';
import { useLogSearch } from './hooks/useLogSearch';
import { downloadAsText } from './utils/downloadLogs';
import type { LogEntry, LogStreamEvent, SearchMatch } from './types';

interface Props {
  sessionId: string;
}

const LogViewerContainer: React.FC<Props> = ({ sessionId }) => {
  const parentRef = useRef<HTMLDivElement>(null);
  const [showTimestamps, setShowTimestamps] = useState(true);
  const [showSources] = useState(true);
  const [wrap, setWrap] = useState(false);
  const [follow, setFollow] = useState(true);
  const [paused, setPaused] = useState(false);
  const [events, setEvents] = useState<LogStreamEvent[]>([]);

  const { entries, version, append, clear, lineCount } = useLogBuffer();

  const search = useLogSearch({ entries, version });

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
    count: lineCount,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 18,
    overscan: 30,
  });

  // Auto-scroll when following
  React.useEffect(() => {
    if (follow && lineCount > 0) {
      rowVirtualizer.scrollToIndex(lineCount - 1, { align: 'end' });
    }
  }, [follow, lineCount, version]);

  // Detect scroll-up to disengage follow
  const handleScroll = useCallback(() => {
    if (!parentRef.current || !follow) return;
    const el = parentRef.current;
    const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
    if (!isAtBottom) {
      setFollow(false);
    }
  }, [follow]);

  const jumpToBottom = useCallback(() => {
    setFollow(true);
    rowVirtualizer.scrollToIndex(lineCount - 1, { align: 'end' });
  }, [lineCount, rowVirtualizer]);

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

  const currentMatchLine =
    search.matches.length > 0 ? search.matches[search.currentMatchIndex]?.lineIndex : -1;

  // Scroll to current match
  React.useEffect(() => {
    if (currentMatchLine >= 0) {
      rowVirtualizer.scrollToIndex(currentMatchLine, { align: 'center' });
    }
  }, [search.currentMatchIndex, currentMatchLine]);

  // Source count
  const sourceCount = useMemo(() => {
    const ids = new Set<string>();
    for (const entry of entries) {
      if (entry.sourceId) ids.add(entry.sourceId);
    }
    return ids.size;
  }, [version]);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <LogViewerToolbar
        searchQuery={search.query}
        onSearchChange={search.setQuery}
        isRegex={search.isRegex}
        onToggleRegex={() => search.setIsRegex(!search.isRegex)}
        caseSensitive={search.caseSensitive}
        onToggleCaseSensitive={() => search.setCaseSensitive(!search.caseSensitive)}
        matchCount={search.totalMatches}
        currentMatch={search.currentMatchIndex}
        onNextMatch={search.nextMatch}
        onPrevMatch={search.prevMatch}
        showTimestamps={showTimestamps}
        onToggleTimestamps={() => setShowTimestamps(!showTimestamps)}
        wrap={wrap}
        onToggleWrap={() => setWrap(!wrap)}
        follow={follow}
        onToggleFollow={() => setFollow(!follow)}
        paused={paused}
        onTogglePaused={() => setPaused(!paused)}
        onDownload={() => downloadAsText(entries)}
        onClear={clear}
        lineCount={lineCount}
        sourceCount={sourceCount}
      />

      {/* Virtual log list */}
      <Box
        ref={parentRef}
        onScroll={handleScroll}
        sx={{
          flex: 1,
          overflow: 'auto',
          bgcolor: 'background.body',
          position: 'relative',
        }}
      >
        <Box
          sx={{
            height: rowVirtualizer.getTotalSize(),
            width: '100%',
            position: 'relative',
          }}
        >
          {rowVirtualizer.getVirtualItems().map((virtualRow) => {
            const entry = entries[virtualRow.index];
            if (!entry) return null;

            return (
              <Box
                key={virtualRow.key}
                data-index={virtualRow.index}
                ref={rowVirtualizer.measureElement}
                sx={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                <LogEntryComponent
                  entry={entry}
                  showTimestamps={showTimestamps}
                  showSources={showSources}
                  wrap={wrap}
                  searchMatches={matchesByLine.get(virtualRow.index)}
                  isCurrentMatch={virtualRow.index === currentMatchLine}
                />
              </Box>
            );
          })}
        </Box>
      </Box>

      {/* Jump to bottom FAB */}
      {!follow && lineCount > 0 && (
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
