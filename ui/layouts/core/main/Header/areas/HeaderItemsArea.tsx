import React from 'react';

// Material-ui
import Box from '@mui/joy/Box';
import IconButton from '@mui/joy/IconButton';
import Icon from '@/components/icons/Icon';
import HeaderIconMenu from './components/HeaderIconMenu';
import HeaderIconButton from './components/HeaderIconButton';
import HeaderIconLink from './components/HeaderIconLink';

// Project-imports
import { type HeaderAreaItemList, type HeaderAreaItemListType, HeaderAreaItemType } from '@/store/header/types';
import usePanes from '@/hooks/usePanes';
import { Tooltip } from '@mui/joy';
import { WindowIsMaximised, WindowMaximise, WindowUnmaximise } from '@runtime/runtime';

type Props = {
  /** The items to display in the header. */
  items: HeaderAreaItemList;
};

/**
 * Display items within an item area on the header
 */
const HeaderItemsArea: React.FC<Props> = ({ items }) => {
  const { addNewPane } = usePanes();

  /**
   * Provide the functionality of the double click behavior like on MacOS
   */
  const handleAreaClick: React.MouseEventHandler = (e) => {
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
    <Box
      onClick={handleAreaClick}
      sx={{
        display: 'flex',
        flexDirection: 'row',
        gap: 1,
        width: '100%',
        height: '100%',
        justifyContent: 'flex-end',
        alignItems: 'center',
        px: 0.5,
        WebkitUserSelect: 'none',
      }}
    >
      {items.map(item => <HeaderItemComponent key={item.id} item={item} />)}
      {/* Temporary to test the panes */}
      <Tooltip enterDelay={1000} title='Add Pane' variant='soft' >

        <IconButton
          name={'add-pane'}
          size='sm'
          variant='outlined'
          color='neutral'
          sx={{
            '--wails-draggable': 'no-drag',
          }}
          onClick={addNewPane}
        >
          <Icon name={'LuSplitSquareHorizontal'} size={18} />
        </IconButton>
      </Tooltip>
    </Box>
  );
};

const HeaderItemComponent = ({ item }: { item: HeaderAreaItemListType }): React.ReactElement => {
  switch (item.type) {
    case HeaderAreaItemType.BUTTON:
      return <HeaderIconButton {...item} />;
    case HeaderAreaItemType.LINK:
      return <HeaderIconLink {...item} />;
    case HeaderAreaItemType.MENU:
      return <HeaderIconMenu {...item} />;
    case HeaderAreaItemType.MODAL:
      // Not defined yet for now
      return <></>;
  }
};

export default HeaderItemsArea;
