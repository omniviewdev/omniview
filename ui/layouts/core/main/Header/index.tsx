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

/**
 * Primary header component for the core main layout
 */
const CoreLayoutHeader: React.FC = () => {
  const { isFullscreen, platform } = useContext(WindowContext);
  const areas = useSelector((state: RootState) => state.header.areas);

  // Compensate for the window controls on MacOS
  const shouldIndent = platform === 'macos' && !isFullscreen;
  const style = { '--CoreLayoutHeader-inset': shouldIndent ? '68px' : '0px' } as React.CSSProperties;

  return (
    <AppShell.Header
      data-testid='app-header'
      className={`CoreLayoutHeader ${styles.Header}`}
      style={style}
      onClick={toggleMaximiseOnDoubleClick}
    >
      {areas?.left.visible && <HeaderItemAreaComponent area={areas.left} />}
      {areas?.center.visible && <HeaderItemAreaComponent area={areas.center} />}
      {areas?.right.visible && <HeaderItemAreaComponent area={areas.right} />}
    </AppShell.Header>
  );
};

const HeaderItemAreaComponent = ({ area }: { area: HeaderArea }): React.ReactElement => {

  switch (area.type) {
    case 'items':
      return <HeaderItemsArea items={area.items as HeaderAreaItemListType[]} />;
    case 'search':
      return <HeaderSearchArea />;
    case 'context':
      return <HeaderContextArea title='' />;
    case 'tabs':
      return <HeaderTabsArea />;
  }
};

CoreLayoutHeader.whyDidYouRender = true;

export default CoreLayoutHeader;
