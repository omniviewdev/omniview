import React, { useContext } from 'react';
import { Box, type BoxProps, GlobalStyles } from '@mui/joy';

// Components
import HeaderContextArea from './areas/HeaderContextArea';
import HeaderItemsArea from './areas/HeaderItemsArea';
import HeaderSearchArea from './areas/HeaderSearchArea';
import { type HeaderArea, type HeaderAreaItemListType } from '@/store/header/types';
import { useSelector } from 'react-redux';
import { type RootState } from '@/store/store';
import HeaderTabsArea from './areas/HeaderTabsArea';
import { WindowContext } from '@/contexts/WindowContext';
import { useSetting } from '@/hooks/useSettings';
import { WindowIsMaximised, WindowMaximise, WindowUnmaximise } from '@runtime/runtime';

/**
 * Primary header component for the core main layout
 */
const CoreLayoutHeader: React.FC<BoxProps> = props => {
  const { isFullscreen, platform } = useContext(WindowContext);
  const areas = useSelector((state: RootState) => state.header.areas);

  // Componsate for the window controls on MacOS
  const shouldIndent = platform === 'macos' && !isFullscreen;

  const handleClick: React.MouseEventHandler = (e) => {
    switch (e.detail) {
      case 0:
        // don't do anything
        break;
      case 1:
        // don't do anything
        break;
      default:
        WindowIsMaximised().then((isMaximized) => {
          if (isMaximized) {
            WindowUnmaximise();
          } else {
            WindowMaximise();
          }
        }).catch((err) => {
          console.error(err);
        });
        break;
    }
  };

  return (
    <>
      <GlobalStyles
        styles={{
          // eslint-disable-next-line @typescript-eslint/naming-convention
          ':root': {
            '--CoreLayoutHeader-height': '41px',
            '--CoreLayoutHeader-inset': shouldIndent ? '68px' : '0px',
          },
        }}
      />
      <Box
        component='header'
        className='CoreLayoutHeader'
        onClick={handleClick}
        sx={[
          {
            pl: 'var(--CoreLayoutHeader-inset)',
            gap: 2,
            // Include the divider border
            height: 'calc(var(--CoreLayoutHeader-height) - 1px)',
            bgcolor: 'background.surface',
            display: 'flex',
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            gridColumn: '1 / -1',
            borderBottom: '1px solid',
            borderColor: 'divider',
            position: 'sticky',
            top: 0,
            zIndex: 1100,
            '--wails-draggable': 'drag',
            WebkitUserSelect: 'none',
          },
          ...(Array.isArray(props.sx) ? props.sx : [props.sx]),
        ]}
      >
        {areas?.left.visible && <HeaderItemAreaComponent area={areas.left} />}
        {areas?.center.visible && <HeaderItemAreaComponent area={areas.center} />}
        {areas?.right.visible && <HeaderItemAreaComponent area={areas.right} />}
      </Box>
    </>
  );
};

const HeaderItemAreaComponent = ({ area }: { area: HeaderArea }): React.ReactElement => {
  // Const useHeaderSearch = useSelector((state: RootState) => state.settings['core'].sections['appearance'].settings['headerSearch'].value)
  const useHeaderSearch = useSetting('core.appearance.headerSearch');

  switch (area.type) {
    case 'items':
      return <HeaderItemsArea items={area.items as HeaderAreaItemListType[]} />;
    case 'search':
      if (useHeaderSearch) {
        return <HeaderSearchArea />;
      }

      return <></>;
    case 'context':
      return <HeaderContextArea title='' />;
    case 'tabs':
      return <HeaderTabsArea />;
  }
};

CoreLayoutHeader.whyDidYouRender = true;

export default CoreLayoutHeader;
