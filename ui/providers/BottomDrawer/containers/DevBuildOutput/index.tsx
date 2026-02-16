import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Box from '@mui/joy/Box';
import Button from '@mui/joy/Button';
import Chip from '@mui/joy/Chip';
import Divider from '@mui/joy/Divider';
import IconButton from '@mui/joy/IconButton';
import Option from '@mui/joy/Option';
import Select from '@mui/joy/Select';
import Tooltip from '@mui/joy/Tooltip';
import Typography from '@mui/joy/Typography';
import { useVirtualizer } from '@tanstack/react-virtual';
import { LuArrowDown, LuArrowDownToLine, LuRefreshCw, LuTrash2, LuCircle } from 'react-icons/lu';

import { devToolsChannel } from '@/features/devtools/events';
import type { DevBuildLine, DevServerState } from '@/features/devtools/types';
import { getAggregateStatus, STATUS_COLORS } from '@/features/devtools/types';

interface Props {
  pluginId?: string;
}

const SOURCE_BADGE_COLORS: Record<string, [string, string]> = {
  vite: ['#1a3a4a', '#7ec8e3'],
  'go-build': ['#1a4a2a', '#7ee3a0'],
  'go-watch': ['#1a4a2a', '#7ee3a0'],
  manager: ['#4a3a1a', '#e3c87e'],
};

interface BuildLineProps {
  line: DevBuildLine;
  showSource: boolean;
}

const BuildLine: React.FC<BuildLineProps> = React.memo(({ line, showSource }) => {
  const isError = line.level === 'error';
  const [bg, fg] = SOURCE_BADGE_COLORS[line.source] ?? ['#3a3a3a', '#cccccc'];

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
        borderLeft: isError ? '3px solid var(--joy-palette-danger-400)' : '3px solid transparent',
        '&:hover': { bgcolor: 'background.level1' },
      }}
    >
      <Typography
        sx={{
          color: 'text.secondary',
          flexShrink: 0,
          fontSize: 'inherit',
          fontFamily: 'inherit',
          lineHeight: 'inherit',
          minWidth: '8ch',
        }}
      >
        {formatTime(line.timestamp)}
      </Typography>

      {showSource && (
        <span
          style={{
            fontSize: '10px',
            lineHeight: '16px',
            height: 16,
            padding: '0 6px',
            borderRadius: 4,
            backgroundColor: bg,
            color: fg,
            flexShrink: 0,
            whiteSpace: 'nowrap',
          }}
        >
          {line.source}
        </span>
      )}

      <Typography
        component="span"
        sx={{
          flex: 1,
          fontSize: 'inherit',
          fontFamily: 'inherit',
          lineHeight: 'inherit',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-all',
          ...(isError && { color: 'danger.plainColor' }),
        }}
      >
        {line.message}
      </Typography>
    </Box>
  );
});

BuildLine.displayName = 'BuildLine';

function formatTime(ts: string): string {
  if (!ts) return '';
  try {
    const d = new Date(ts);
    return d.toLocaleTimeString(undefined, {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return ts;
  }
}

const DevBuildOutput: React.FC<Props> = ({ pluginId }) => {
  const parentRef = useRef<HTMLDivElement>(null);
  const [lines, setLines] = useState<DevBuildLine[]>([]);
  const [follow, setFollow] = useState(true);
  const [sourceFilter, setSourceFilter] = useState<string | null>(null);
  const [serverState, setServerState] = useState<DevServerState | null>(null);
  const isAutoScrolling = useRef(false);

  useEffect(() => {
    const unsubLog = devToolsChannel.on('onBuildLog', (line) => {
      if (pluginId && line.pluginID !== pluginId) return;
      setLines((prev) => {
        const next = [...prev, line];
        return next.length > 10000 ? next.slice(-10000) : next;
      });
    });

    const unsubStatus = devToolsChannel.on('onStatusChange', (state) => {
      if (pluginId && state.pluginID !== pluginId) return;
      setServerState(state);
    });

    return () => {
      unsubLog();
      unsubStatus();
    };
  }, [pluginId]);

  const filteredLines = useMemo(() => {
    if (!sourceFilter) return lines;
    return lines.filter((l) => l.source === sourceFilter);
  }, [lines, sourceFilter]);

  const rowVirtualizer = useVirtualizer({
    count: filteredLines.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 18,
    overscan: 30,
  });

  useEffect(() => {
    if (follow && filteredLines.length > 0) {
      isAutoScrolling.current = true;
      rowVirtualizer.scrollToIndex(filteredLines.length - 1, { align: 'end' });
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          isAutoScrolling.current = false;
        });
      });
    }
  }, [follow, filteredLines.length, rowVirtualizer]);

  const handleScroll = useCallback(() => {
    if (!parentRef.current || isAutoScrolling.current) return;
    const el = parentRef.current;
    const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
    if (isAtBottom && !follow) setFollow(true);
    else if (!isAtBottom && follow) setFollow(false);
  }, [follow]);

  const handleClear = useCallback(() => setLines([]), []);

  const handleRestart = useCallback(() => {
    if (pluginId) devToolsChannel.emit('onRestartDevServer', pluginId);
  }, [pluginId]);

  const jumpToBottom = useCallback(() => {
    setFollow(true);
    isAutoScrolling.current = true;
    rowVirtualizer.scrollToIndex(filteredLines.length - 1, { align: 'end' });
    requestAnimationFrame(() => { isAutoScrolling.current = false; });
  }, [filteredLines.length, rowVirtualizer]);

  const virtualItems = rowVirtualizer.getVirtualItems();
  const paddingTop = virtualItems.length > 0 ? virtualItems[0].start : 0;
  const paddingBottom =
    virtualItems.length > 0
      ? rowVirtualizer.getTotalSize() - virtualItems[virtualItems.length - 1].end
      : 0;

  const aggStatus = serverState ? getAggregateStatus(serverState) : null;

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
      {/* Toolbar */}
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
        {aggStatus && (
          <Chip
            size="sm"
            variant="soft"
            color={STATUS_COLORS[aggStatus]}
            startDecorator={<LuCircle size={8} />}
            sx={{ '--Chip-minHeight': '20px', fontSize: '11px' }}
          >
            {aggStatus}
          </Chip>
        )}

        <Divider orientation="vertical" sx={{ mx: 0.5 }} />

        <Select
          size="sm"
          variant="plain"
          value={sourceFilter ?? 'all'}
          onChange={(_, val) => setSourceFilter(val === 'all' ? null : val)}
          sx={{ minWidth: 80, fontSize: '12px' }}
        >
          <Option value="all">All</Option>
          <Option value="vite">Vite</Option>
          <Option value="go-build">Go Build</Option>
          <Option value="go-watch">Go Watch</Option>
        </Select>

        <Divider orientation="vertical" sx={{ mx: 0.5 }} />

        <Tooltip title="Restart dev server">
          <IconButton size="sm" variant="plain" color="neutral" onClick={handleRestart}>
            <LuRefreshCw size={14} />
          </IconButton>
        </Tooltip>

        <Tooltip title="Clear output">
          <IconButton size="sm" variant="plain" color="neutral" onClick={handleClear}>
            <LuTrash2 size={14} />
          </IconButton>
        </Tooltip>

        <Tooltip title={follow ? 'Following' : 'Follow output'}>
          <IconButton
            size="sm"
            variant={follow ? 'soft' : 'plain'}
            color={follow ? 'primary' : 'neutral'}
            onClick={() => setFollow(!follow)}
          >
            <LuArrowDownToLine size={14} />
          </IconButton>
        </Tooltip>

        <Box sx={{ flex: 1 }} />
        <Typography level="body-xs" sx={{ color: 'text.tertiary', mr: 1 }}>
          {filteredLines.length.toLocaleString()} lines
        </Typography>
      </Box>

      {/* Virtualized output */}
      <Box
        ref={parentRef}
        onScroll={handleScroll}
        sx={{ flex: 1, minHeight: 0, overflow: 'auto', bgcolor: 'background.body' }}
      >
        <Box sx={{ paddingTop: `${paddingTop}px`, paddingBottom: `${paddingBottom}px` }}>
          {virtualItems.map((virtualRow) => {
            const line = filteredLines[virtualRow.index];
            if (!line) return null;

            return (
              <Box
                key={virtualRow.key}
                data-index={virtualRow.index}
                ref={rowVirtualizer.measureElement}
                sx={{ minWidth: '100%' }}
              >
                <BuildLine line={line} showSource={!sourceFilter} />
              </Box>
            );
          })}
        </Box>
      </Box>

      {/* Jump to bottom FAB */}
      {!follow && filteredLines.length > 0 && (
        <Button
          size="sm"
          variant="soft"
          color="neutral"
          startDecorator={<LuArrowDown size={14} />}
          onClick={jumpToBottom}
          sx={{ position: 'absolute', bottom: 16, right: 16, zIndex: 10 }}
        >
          Jump to bottom
        </Button>
      )}
    </Box>
  );
};

export default React.memo(DevBuildOutput, (prev, next) => prev.pluginId === next.pluginId);
