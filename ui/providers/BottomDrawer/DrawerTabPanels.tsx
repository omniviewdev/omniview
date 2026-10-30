import React from 'react';
import { useBottomDrawer } from '@omniviewdev/runtime';
import TerminalContainer from '@/providers/BottomDrawer/containers/Terminal';
import LogViewerContainer from '@/providers/BottomDrawer/containers/LogViewer';
import DevBuildViewer from '@/providers/BottomDrawer/containers/DevBuildViewer';
import PluginLogViewer from '@/providers/BottomDrawer/containers/PluginLogViewer';
import EditorDebugPanel from '@/providers/BottomDrawer/containers/EditorDebugPanel';
import styles from './DrawerTabPanels.module.css';

const TerminalContainerMemo = React.memo(TerminalContainer, (prev, next) => {
  return prev.sessionId === next.sessionId
    && prev.tab?.properties?.status === next.tab?.properties?.status;
});

const LogViewerContainerMemo = React.memo(LogViewerContainer, (prev, next) => {
  return prev.sessionId === next.sessionId;
});

/**
 * The content of every drawer tab, with only the focused one visible. Shared by
 * the workspace bottom drawer and the panel window.
 */
const DrawerTabPanels: React.FC = () => {
  const { tabs, focused } = useBottomDrawer();
  const focusedTabId = tabs[focused]?.id;

  return (
    <div className={styles.Panels}>
      {tabs.map((tab) => (
        <div
          key={tab.id}
          className={styles.Panel}
          // visibility (not display:none) keeps xterm measured and fitted,
          // which avoids a flash of doubled lines when switching tabs.
          data-active={focusedTabId === tab.id || undefined}
        >
          {tab.variant === 'editor-debug' ? (
            <EditorDebugPanel />
          ) : tab.variant === 'devbuild' ? (
            <DevBuildViewer pluginId={tab.id.replace(/^devbuild-/, '')} />
          ) : tab.variant === 'plugin-logs' ? (
            <PluginLogViewer pluginId={tab.id.replace(/^pluginlogs-/, '')} />
          ) : tab.variant === 'logs' ? (
            <LogViewerContainerMemo sessionId={tab.id} />
          ) : (
            <TerminalContainerMemo sessionId={tab.id} tab={tab} />
          )}
        </div>
      ))}
    </div>
  );
};

export default DrawerTabPanels;
