import React from 'react';

// material-ui
import IconButton from '@mui/joy/IconButton';
import List from '@mui/joy/List';
import ListItemButton from '@mui/joy/ListItemButton';
import Tabs from '@mui/joy/Tabs';
import TabList from '@mui/joy/TabList';
import Tab from '@mui/joy/Tab';
import Typography from '@mui/joy/Typography';
import Stack from '@mui/joy/Stack';
import {  styled } from '@mui/joy';
import { Unstable_Popup as BasePopup } from '@mui/base/Unstable_Popup';
import { ClickAwayListener } from '@mui/base';

// third-party
import {
  DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext, sortableKeyboardCoordinates, horizontalListSortingStrategy, useSortable,
} from '@dnd-kit/sortable';
import { restrictToHorizontalAxis, restrictToParentElement } from '@dnd-kit/modifiers';
import { CSS } from '@dnd-kit/utilities';

// provider
import { type BottomDrawerTab } from '@/providers/BottomDrawer/types';

// project imports
import Icon from '@/components/icons/Icon';
import { LuPlus, LuX } from 'react-icons/lu';
import useBottomDrawer from '@/hooks/useBottomDrawer';
import { ListSessions, CreateTerminal } from '@api/exec/Client';
import { exec } from '@api/models';

type TabContextMenuProps = {
  selected: number;
  onClose: () => void;
};

const TabContextMenu: React.FC<TabContextMenuProps> = ({ selected, onClose }) => {
  const { tabs, closeTab, closeTabs } = useBottomDrawer();

  const handleCloseTab = () => {
    closeTab({ index: selected });
    onClose();
  };

  const handleCloseTabsToRight = () => {
    // get all indexes to the right of the selected tab 
    let indices = [];
    for (let i = selected + 1; i < tabs.length; i++) {
      indices.push(i);
    }

    console.log('closing tabs to right', indices);
    closeTabs(indices.map(index => ({ index })));
    onClose();
  };

  const handleCloseTabsToLeft = () => {
    // get all indexes to the left of the selected tab 
    let indices = [];
    for (let i = 0; i < selected; i++) {
      indices.push(i);
    }

    closeTabs(indices.map(index => ({ index })));
    onClose();
  };

  const handlecloseOtherTabs = () => {
    // get all indexes to the left of the selected tab 
    let indices = [];
    for (let i = 0; i < tabs.length; i++) {
      if (i !== selected) {
        indices.push(i);
      }
    }

    closeTabs(indices.map(index => ({ index })));
    onClose();
  };
    

  return (
    <List
      size='sm'
      variant="outlined"
      sx={{
        maxWidth: 400,
        borderRadius: 'sm',
        zIndex: 9999,
        backgroundColor: 'background.body',
        '--ListItem-paddingLeft': '0.5rem',
        '--ListItem-paddingRight': '1.5rem',
        '--ListItem-paddingY': '0rem',
      }}
    >
      <ListItemButton onClick={handleCloseTab}>Close Tab</ListItemButton>
      <ListItemButton onClick={handleCloseTabsToRight}>Close Tabs to Right</ListItemButton>
      <ListItemButton onClick={handleCloseTabsToLeft}>Close Tabs to Left</ListItemButton>
      <ListItemButton onClick={handlecloseOtherTabs}>Close other Tabs</ListItemButton>
    </List>
  );
};


/**
 * Renders the tabs for the bottom drawer.
 */
const BottomDrawerTabs: React.FC = () => {
  const { tabs, focused, focusTab, closeTab, createTab, createTabs, reorderTab } = useBottomDrawer();

  // run our tooltip from the parent so we only render one of them
  // eslint-disable-next-line @typescript-eslint/ban-types
  const [contextSelected, setContextSelected] = React.useState<{ index: number; el: HTMLElement } | null>(null);

  const handleContextMenuClick = React.useCallback((tabIndex: number, event: React.MouseEvent<HTMLElement>) => {
    event.preventDefault();
    setContextSelected(contextSelected && contextSelected.index === tabIndex ? null : {
      index: tabIndex,
      el: event.currentTarget,
    });
  }, [contextSelected, setContextSelected]);

  const contextMenuOpen = Boolean(contextSelected);

  // eslint-disable-next-line @typescript-eslint/ban-types -- null is required by onChange
  const handleChange = React.useCallback((_event: React.SyntheticEvent | null, newValue: string | number | null) => {
    if (typeof newValue === 'number') {
      focusTab({ index: newValue });
    }
  }, [focusTab]);

  const handleCreate = (variant: 'terminal' | 'browser') => {
    switch (variant) {
      case 'terminal':
        CreateTerminal(exec.CreateTerminalOptions.createFrom({ command: [] }))
          .then(session => {
            createTab({
              id: session.id,
              title: `Session ${session.id.substring(0, 8)}`,
              variant: 'terminal', 
              icon: 'LuTerminalSquare',
            });
          })
          .catch(err => {
            console.error(err); 
          });
        break;
      case 'browser':
        break;
    }
  };

  const handleRemove = React.useCallback((index: number) => {
    closeTab({ index });
  }, [closeTab]);

  // Sensors for DND Kit
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  // Handler for drag end
  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      // Dispatch an action to reorder the tabs in your store
      // Replace this with your actual logic to update the order of tabs
      reorderTab(active.id as number, over.id as number);
    }
  };

  React.useEffect(() => {
    ListSessions()
      .then(sessions => {
        console.log('sessions', sessions);
        const newTabs: BottomDrawerTab[] = [];

        // find and upsert any missing sessions where the id doesn't exist
        sessions.forEach(session => {
          const existing = tabs.find(tab => tab.id === session.id);
          if (existing) {
            return;
          }

          newTabs.push({
            id: session.id,
            title: `Session ${session.id.substring(0, 8)}`,
            variant: 'terminal',
            icon: 'LuTerminalSquare',
            properties: session.labels,
            createdAt: new Date(),
            updatedAt: new Date(),
          });
        });

        console.log('newTabs', newTabs);
        createTabs(newTabs);
      }).catch(err => {
        console.error(err);
      });
  }, []);

  return (
    <Stack 
      direction="row" 
      alignItems={'center'} 
      height={33} 
      maxHeight={33} 
      minHeight={33} 
      gap={0.25} 
      px={0.25}
      sx={{
        borderBottom: '1px solid',
        borderBottomColor: 'divider',
      }}
    >
      <IconButton 
        size="sm"
        variant="plain"
        sx={{ 
          flex: 'none',
          minHeight: 28,
          minWidth: 28,
        }}
        onClick={() => {
          handleCreate('terminal'); 
        }}
      >
        <LuPlus size={16} />
      </IconButton>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
        modifiers={[restrictToParentElement, restrictToHorizontalAxis]} 
      >

        <SortableContext items={tabs.map((_, index) => index)} strategy={horizontalListSortingStrategy}>
          {tabs.length !== 0 &&
          <Tabs 
            size='sm'
            aria-label="bottom drawer tabs"
            value={focused}
            onChange={handleChange}
            sx={{
              flex: 1,
              overflow: 'hidden',
            }}
          >
            <TabList
              disableUnderline
              variant='plain'
              color='neutral'
              sx={{
                overflow: 'auto',
                scrollSnapType: 'x mandatory',
                '&::-webkit-scrollbar': { display: 'none' },
              }}
            >
              {tabs.map((tab, index) => (
                <MemoizedBottomDrawerTabComponent 
                  key={`bottom-drawer-tab-${index}`} 
                  {...tab} 
                  index={index} 
                  selected={focused === index}
                  onRemove={handleRemove}
                  onChange={handleChange}
                  handleContextMenuClick={handleContextMenuClick}
                />
              ))}
            </TabList>
          </Tabs>
          }

        </SortableContext>
      </DndContext>
      <BasePopup style={{ zIndex: 9999 }} id={'tab-context-menu'} open={contextMenuOpen} anchor={contextSelected?.el}>
        <ClickAwayListener 
          onClickAway={() => {
            setContextSelected(null);
          }}
        >
          <PopupBody>
            <TabContextMenu 
              selected={contextSelected === null ? -1 : contextSelected.index}
              onClose={() => { 
                setContextSelected(null);
              }} />
          </PopupBody>
        </ClickAwayListener>
      </BasePopup>
    </Stack>
  );
};

type BottomDrawerTabProps = BottomDrawerTab & {
  index: number;
  selected: boolean;
  onRemove: (index: number) => void;
  onChange: (event: React.SyntheticEvent, newValue: string | number) => void;
  handleContextMenuClick: (tabIndex: number, event: React.MouseEvent<HTMLElement>) => void;
};

const PopupBody = styled('div')(
  ({ theme }) => `
  width: max-content;
  border-radius: 8px;
  border: 1px solid ${theme.palette.divider};
  background-color: ${theme.palette.background.popup};
  box-shadow: ${
  theme.palette.mode === 'dark'
    ? '0px 4px 8px rgb(0 0 0 / 0.7)'
    : '0px 4px 8px rgb(0 0 0 / 0.1)'
};
  font-family: 'IBM Plex Sans', sans-serif;
  font-size: 0.875rem;
  z-index: 1;
`,
);

const BottomDrawerTabComponent: React.FC<BottomDrawerTabProps> = ({ id, index, title, icon, selected, onRemove, onChange, handleContextMenuClick }) => {
  const handleClick = (event: React.MouseEvent<HTMLElement>) => {
    handleContextMenuClick(index, event);
  };

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
  } = useSortable({ id: index });

  return (
    <Tab 
      key={`bottom-drawer-tab-${id}`} 
      ref={setNodeRef}
      variant='plain'
      {...attributes}
      {...listeners}
      sx={{
        pt: 0,
        pb: selected ? 0.25 : 0,
        px: 1,
        alignItems: 'center',
        minWidth: 150,
        flex: 'none', 
        scrollSnapAlign: 'start',
        borderRightColor: 'divider',
        borderLeftColor: index === 0 ? 'divider' : 'transparent',
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      onChange={onChange}
      onContextMenu={event => {
        event.preventDefault();
        handleClick(event);
      }}
    >
      <Stack 
        direction="row" 
        justifyContent={'space-between'} 
        alignItems={'center'} 
        gap={2}
        width={'100%'}
      >
        <Typography 
          fontSize={13}
          textColor={selected ? 'neutral.50' : 'text'}
          fontWeight={selected ? 500 : 400}
          level="body-sm"
          sx={{
            'user-select': 'none',
            'WebkitUserSelect': 'none',
          }}
          startDecorator={
            icon !== undefined ? (
              typeof icon === 'string' ? <Icon name={icon} size={14} /> : icon
            ) : null
          }
        >
          {title}
        </Typography>
        <LuX size={16} onClick={() => { 
          onRemove(index);
        }} />
      </Stack>
    </Tab>
  );
};

const MemoizedBottomDrawerTabComponent = React.memo(BottomDrawerTabComponent);

export default BottomDrawerTabs;
