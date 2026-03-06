import React, { useMemo } from 'react';
import LogViewerContainer from './LogViewer';
import { createPluginLogSource } from './LogViewer/sources/pluginLogSource';

interface Props {
  pluginId: string;
}

const PluginLogViewer: React.FC<Props> = ({ pluginId }) => {
  const source = useMemo(() => createPluginLogSource(pluginId), [pluginId]);
  return <LogViewerContainer source={source} />;
};

export default React.memo(PluginLogViewer, (prev, next) => prev.pluginId === next.pluginId);
