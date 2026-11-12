import React, { useContext } from 'react';
import { AppShell } from '@omniviewdev/base-ui';

// Components
import HeaderContextArea from './areas/HeaderContextArea';
import HeaderItemsArea from './areas/HeaderItemsArea';
import HeaderSearchArea from './areas/HeaderSearchArea';
import { type HeaderArea, type HeaderAreaItemListType } from '@/store/header/types';
import { useSelector } from 'react-redux';
import { type RootState } from '@/store/store';
import HeaderTabsArea from './areas/HeaderTabsArea';
import { WindowContext } from '@/contexts/WindowContext';
import { toggleMaximiseOnDoubleClick } from './toggleMaximise';
import styles from './Header.module.css';
import { GlobalCommandSearch } from '@/features/command-search/GlobalCommandSearch';
import { useGlobalCommandSearch } from '@/features/command-search/useGlobalCommandSearch';
import { Call } from '@wailsio/runtime';
import { openSettings } from '@omniviewdev/runtime';

function UpdateIndicator() {
  const [version, setVersion] = React.useState('');
  React.useEffect(() => {
    const refresh = () => {
      void Call.ByName('github.com/omniviewdev/omniview.UpdateService.Status')
        .then((value: unknown) => {
          const status = value as { state: string; availableVersion: string };
          setVersion(status.state === 'ready' ? status.availableVersion : '');
        }).catch(() => {});
    };
    refresh();
    const timer = window.setInterval(refresh, 5000);
    return () => window.clearInterval(timer);
  }, []);
  if (!version) return null;
  return <button onClick={() => { void openSettings('/settings?section=core&category=updates'); }}>Update {version} ready</button>;
}

/**
 * Primary header component for the core main layout
 */
const CoreLayoutHeader: React.FC = () => {
  const { isFullscreen, platform } = useContext(WindowContext);
  const areas = useSelector((state: RootState) => state.header.areas);
  const search = useGlobalCommandSearch();

  // Compensate for the window controls on MacOS
  const shouldIndent = platform === 'macos' && !isFullscreen;
  const style: React.CSSProperties & Record<`--${string}`, string> = {
    '--CoreLayoutHeader-inset': shouldIndent ? '68px' : '0px',
  };

  return (
    <>
      <AppShell.Header
        data-testid='app-header'
        className={`CoreLayoutHeader ${styles.Header}`}
        style={style}
        onClick={toggleMaximiseOnDoubleClick}
      >
        {areas?.left.visible && <HeaderItemAreaComponent area={areas.left} onOpenSearch={search.open} />}
        {areas?.center.visible && <HeaderItemAreaComponent area={areas.center} onOpenSearch={search.open} />}
        {areas?.right.visible && <HeaderItemAreaComponent area={areas.right} onOpenSearch={search.open} />}
        <UpdateIndicator />
      </AppShell.Header>
      <GlobalCommandSearch {...search.paletteProps} />
    </>
  );
};

const HeaderItemAreaComponent = ({
  area,
  onOpenSearch,
}: {
  area: HeaderArea;
  onOpenSearch: () => void;
}): React.ReactElement => {
  switch (area.type) {
    case 'items':
      return <HeaderItemsArea items={area.items as HeaderAreaItemListType[]} />;
    case 'search':
      return <HeaderSearchArea onOpen={onOpenSearch} />;
    case 'context':
      return <HeaderContextArea title='' />;
    case 'tabs':
      return <HeaderTabsArea />;
  }
};

CoreLayoutHeader.whyDidYouRender = true;

export default CoreLayoutHeader;
