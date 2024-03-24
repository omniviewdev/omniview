import { type FC } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

// Dnd-kit
import {
  DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext, sortableKeyboardCoordinates, horizontalListSortingStrategy, useSortable,
} from '@dnd-kit/sortable';
import { restrictToHorizontalAxis, restrictToParentElement } from '@dnd-kit/modifiers';

import { CSS } from '@dnd-kit/utilities';

// Types
import { type Tab as ITab } from '@/store/tabs/types';

// Material-ui
import Typography from '@mui/joy/Typography';
import Sheet from '@mui/joy/Sheet';
import Stack from '@mui/joy/Stack';
import AspectRatio from '@mui/joy/AspectRatio';
import IconButton from '@mui/joy/IconButton';

// Redux
import type { RootState } from '@/store/store';
import { useSelector, useDispatch } from 'react-redux';
import { handleAddTab, handleRemoveTab, handleReorderTabsByID } from '@/store/tabs/slice';

// Icons
import { LuBox, LuX } from 'react-icons/lu';
import { FaPlus } from 'react-icons/fa';

type TabProps = {
  tab: ITab;
  handleTabClick: (tabId: string) => void;
  handleCloseTab: (tabId: string) => void;
  clusterId: string;
  selectedTabs: string[];
};

/**
 * Represents a single tab in the tab provider
 */
const Tab: FC<TabProps> = ({ tab, handleTabClick, handleCloseTab, clusterId, selectedTabs }) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
  } = useSortable({ id: tab.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const handleTabClose = (event: React.MouseEvent, id: string) => {
    event.stopPropagation();
    handleCloseTab(id);
  };

  return (
    <Sheet
      key={tab.id}
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className='Tab'
      variant='plain'
      onClick={() => {
        handleTabClick(tab.id);
      }}
      sx={{
        gap: 1.5,
        display: 'flex',
        flexDirection: 'row',
        justifyContent: 'flex-start',
        alignItems: 'center',
        textAlign: 'center',
        borderRadius: 'sm',
        cursor: 'pointer',
        border: atob(clusterId || '') == tab.cluster || selectedTabs.includes(tab.id) ? '1px solid' : '1px solid transparent',
        backgroundColor: atob(clusterId || '') == tab.cluster || selectedTabs.includes(tab.id) ? undefined : '#1E1E1E',
        pl: 1,
        pr: 1,
        '--wails-draggable': 'no-drag',
        WebkitUserSelect: 'none',
      }}
    >
      {Boolean(tab.icon) && typeof tab.icon === 'string'
        ? <AspectRatio ratio='1' sx={{ width: 22, borderRadius: 4 }}>
          <img
            src={tab.icon}
            srcSet={`${tab.icon} 2x`}
            loading='lazy'
            alt=''
          />
        </AspectRatio>
        : <LuBox />
      }
      <Typography level='title-sm' minWidth={100} noWrap flexGrow={1} textAlign={'start'}>{tab.label}</Typography>
      <IconButton
        variant='plain'
        size='sm'
        onClick={e => {
          handleTabClose(e, tab.id);
        }}
        sx={{
          minHeight: 0, minWidth: 0, padding: 0.5, backgroundColor: 'transparent',
        }}
      >
        <LuX />
      </IconButton>
    </Sheet>
  );
};

type TabBarProviderProps = Record<string, unknown>;

const TabBarProvider: FC<TabBarProviderProps> = ({ }) => {
  const { clusterId } = useParams<{ clusterId: string }>();
  const navigate = useNavigate();

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
      dispatch(handleReorderTabsByID({ tabId1: active.id as string, tabId2: over.id as string, strategy: 'shift' }));
    }
  };

  const dispatch = useDispatch();
  const tabs = useSelector((state: RootState) => state.tabs.tabs);
  const selectedTabs = useSelector((state: RootState) => state.tabs.windows.filter(window => Boolean(window.tabId)).map(window => window.tabId));

  const handleTabClick = (tabId: string) => {
    // Find the cluster id for the tab
    const tab = tabs.find(tab => tab.id === tabId);
    if (!tab?.cluster) {
      return;
    }

    navigate(`/explorer/${btoa(tab.cluster)}/pods`);
  };

  const handleCreateNewTab = () => {
    dispatch(handleAddTab({ cluster: 'gc-int', label: 'gc-int' }));
  };

  const handleCloseTab = (tabId: string) => {
    dispatch(handleRemoveTab(tabId));
  };

  return (
    <Sheet
      className='TabBarProvider'
      sx={{
        height: '100%',
        maxHeight: '100%',
        display: 'flex',
        flexDirection: 'row',
        justifyContent: 'space-between',
        gap: 0.5,
        p: 0.5,
      }}
    >
      {/* Account for apple menu bar with padding */}
      <Stack direction='row' gap={1}>
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
          modifiers={[restrictToParentElement, restrictToHorizontalAxis]} >
          <SortableContext items={tabs.map(tab => tab.id)} strategy={horizontalListSortingStrategy}>
            {tabs.map(tab => (
              <Tab tab={tab} handleTabClick={handleTabClick} handleCloseTab={handleCloseTab} clusterId={clusterId!} selectedTabs={selectedTabs} />
            ))}
          </SortableContext>
        </DndContext>
        <Sheet
          className='Tab'
          variant='soft'
          onClick={handleCreateNewTab}
          sx={{
            gap: 1.5,
            display: 'flex',
            flexDirection: 'row',
            justifyContent: 'center',
            alignItems: 'center',
            textAlign: 'center',
            borderRadius: 'sm',
            cursor: 'pointer',
            px: 1.5,
            '--wails-draggable': 'no-drag',
          }}
        >
          <FaPlus size={12} />
        </Sheet>
      </Stack>
    </Sheet>
  );
};

export default TabBarProvider;
