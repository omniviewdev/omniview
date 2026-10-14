import React, { useEffect, useMemo, useState } from 'react';
import { Chip, IconButton } from '@omniviewdev/base-ui';
import { LuHammer, LuRefreshCw, LuCircle } from 'react-icons/lu';

import LogViewerContainer from './LogViewer';
import { createDevBuildSource } from './LogViewer/sources/devBuildSource';
import { devToolsChannel } from '@/features/devtools/events';
import type { DevServerState } from '@/features/devtools/types';
import { getAggregateStatus, STATUS_COLORS } from '@/features/devtools/types';
import HintTooltip from '@/components/base/HintTooltip';

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
      size='xs'
      variant='soft'
      color={STATUS_COLORS[aggStatus] === 'primary' ? 'brand' : STATUS_COLORS[aggStatus]}
      startDecorator={<LuCircle size={8} />}
    >
      {aggStatus}
    </Chip>
  ) : null;

  const toolbarActions = useMemo(() => (
    <>
      <HintTooltip content='Rebuild plugin binary'>
        <IconButton
          size='sm'
          variant='ghost'
          color='neutral'
          aria-label='Rebuild plugin binary'
          onClick={() => devToolsChannel.emit('onRebuildPlugin', pluginId)}
        >
          <LuHammer size={14} />
        </IconButton>
      </HintTooltip>
      <HintTooltip content='Restart dev server'>
        <IconButton
          size='sm'
          variant='ghost'
          color='neutral'
          aria-label='Restart dev server'
          onClick={() => devToolsChannel.emit('onRestartDevServer', pluginId)}
        >
          <LuRefreshCw size={14} />
        </IconButton>
      </HintTooltip>
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
