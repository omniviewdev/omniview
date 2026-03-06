import React, { useEffect, useMemo, useState } from 'react';
import { Chip } from '@omniviewdev/ui';
import { IconButton } from '@omniviewdev/ui/buttons';
import { Tooltip } from '@omniviewdev/ui/overlays';
import { LuHammer, LuRefreshCw, LuCircle } from 'react-icons/lu';

import LogViewerContainer from './LogViewer';
import { createDevBuildSource } from './LogViewer/sources/devBuildSource';
import { devToolsChannel } from '@/features/devtools/events';
import type { DevServerState } from '@/features/devtools/types';
import { getAggregateStatus, STATUS_COLORS } from '@/features/devtools/types';

interface Props {
  pluginId: string;
}

const DevBuildViewer: React.FC<Props> = ({ pluginId }) => {
  const source = useMemo(() => createDevBuildSource(pluginId), [pluginId]);
  const [serverState, setServerState] = useState<DevServerState | null>(null);

  useEffect(() => {
    const unsub = devToolsChannel.on('onStatusChange', (state) => {
      if (state.pluginID !== pluginId) return;
      setServerState(state);
    });
    return unsub;
  }, [pluginId]);

  const aggStatus = serverState ? getAggregateStatus(serverState) : null;

  const toolbarPrefix = aggStatus ? (
    <Chip
      size="sm"
      emphasis="soft"
      color={STATUS_COLORS[aggStatus]}
      icon={<LuCircle size={8} />}
      label={aggStatus}
      sx={{ '--Chip-minHeight': '20px', fontSize: '11px' }}
    />
  ) : null;

  const toolbarActions = useMemo(() => (
    <>
      <Tooltip content="Rebuild plugin binary">
        <IconButton
          size="sm"
          emphasis="ghost"
          color="neutral"
          onClick={() => devToolsChannel.emit('onRebuildPlugin', pluginId)}
        >
          <LuHammer size={14} />
        </IconButton>
      </Tooltip>
      <Tooltip content="Restart dev server">
        <IconButton
          size="sm"
          emphasis="ghost"
          color="neutral"
          onClick={() => devToolsChannel.emit('onRestartDevServer', pluginId)}
        >
          <LuRefreshCw size={14} />
        </IconButton>
      </Tooltip>
    </>
  ), [pluginId]);

  return (
    <LogViewerContainer
      source={source}
      toolbarPrefix={toolbarPrefix}
      toolbarActions={toolbarActions}
    />
  );
};

export default React.memo(DevBuildViewer, (prev, next) => prev.pluginId === next.pluginId);
