import { type FC, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

// Dnd-kit
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  horizontalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import {
  restrictToHorizontalAxis,
  restrictToParentElement,
} from '@dnd-kit/modifiers';

import { CSS } from '@dnd-kit/utilities';

// Types
import { type Tab } from '@/store/tabs/types';

// Material-ui
import CssBaseline from '@mui/material/CssBaseline';
import Box from '@mui/material/Box';
import GlobalStyles from '@mui/material/GlobalStyles';
import Divider from '@mui/material/Divider';
import { Text } from '@omniviewdev/ui/typography';
import { Stack } from '@omniviewdev/ui/layout';
import { IconButton } from '@omniviewdev/ui/buttons';

// Redux
import type { RootState } from '@/store/store';
import { useSelector, useDispatch } from 'react-redux';
import {
  handleAddTab,
  handleBrowserResize,
  handleRemoveTab,
  handleReorderTabsByID,
} from '@/store/tabs/slice';

// Icons
import { LuAppWindow, LuBox, LuHouse, LuSettings, LuX } from 'react-icons/lu';
import { FaPlus } from 'react-icons/fa';
import { WindowIsFullscreen } from '@omniviewdev/runtime/runtime';

type Props = {
  children?: React.ReactNode;
};

const AppContainerProvider: FC<Props> = ({ children }) => {
  const dispatch = useDispatch();

  function reportWindowSize() {
    console.log('new window size', {
      width: window.innerWidth,
      height: window.innerHeight,
    });
    dispatch(
      handleBrowserResize({
        width: window.innerWidth,
        height: window.innerHeight,
      })
    );
  }

  window.onresize = reportWindowSize;

  return (
    <>
      <CssBaseline />
      <Box
        sx={{ display: 'flex', minHeight: '100dvh', flexDirection: 'column' }}
      >
        <HeaderTabBar />
        <Divider />
        <Box
          component="main"
          className="MainContainer"
          // Make fill entire width and height of the screen
          sx={{
            p: 0,
            m: 0,
            width: '100%',
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {children}
        </Box>
      </Box>
    </>
  );
};

type HeaderTabProps = {
  tab: Tab;
  handleTabClick: (tabId: string) => void;
  handleCloseTab: (tabId: string) => void;
  clusterId: string;
  selectedTabs: string[];
};

const HeaderTab: FC<HeaderTabProps> = ({
  tab,
  handleTabClick,
  handleCloseTab,
  clusterId,
  selectedTabs,
}) => {
  const { attributes, listeners, setNodeRef, transform, transition } =
    useSortable({ id: tab.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <Box
      key={tab.id}
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className="Tab"
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
        borderRadius: 1,
        cursor: 'pointer',
        border:
          atob(clusterId || '') == tab.cluster || selectedTabs.includes(tab.id)
            ? '1px solid'
            : '1px solid transparent',
        backgroundColor:
          atob(clusterId || '') == tab.cluster || selectedTabs.includes(tab.id)
            ? undefined
            : '#1E1E1E',
        pl: 1,
        pr: 1,
      }}
    >
      {Boolean(tab.icon) && typeof tab.icon === 'string' ? (
        <Box sx={{ width: 22, aspectRatio: '1', borderRadius: 1, overflow: 'hidden' }}>
          <img src={tab.icon} srcSet={`${tab.icon} 2x`} loading="lazy" alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        </Box>
      ) : (
        <LuBox />
      )}
      <Text
        weight="semibold"
        size="sm"
        sx={{ minWidth: 100, flexGrow: 1, textAlign: 'start', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
      >
        {tab.label}
      </Text>
      <IconButton
        emphasis="ghost"
        size="sm"
        onClick={() => {
          handleCloseTab(tab.id);
        }}
        sx={{
          minHeight: 0,
          minWidth: 0,
          padding: 0.5,
          backgroundColor: 'transparent',
        }}
      >
        <LuX />
      </IconButton>
    </Box>
  );
};

type HeaderTabBarProps = Record<string, unknown>;

const HeaderTabBar: FC<HeaderTabBarProps> = ({ }) => {
  const [isFullscreen, setIsFullscreen] = useState(false);
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
    })
  );

  // Handler for drag end
  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      // Dispatch an action to reorder the tabs in your store
      // Replace this with your actual logic to update the order of tabs
      dispatch(
        handleReorderTabsByID({
          tabId1: active.id as string,
          tabId2: over.id as string,
          strategy: 'shift',
        })
      );
    }
  };

  useEffect(() => {
    async function isFullscreen() {
      setIsFullscreen(await WindowIsFullscreen());
    }

    isFullscreen();
  }, [window.innerWidth, window.innerHeight]);

  const dispatch = useDispatch();
  const tabs = useSelector((state: RootState) => state.tabs.tabs);
  const selectedTabs = useSelector((state: RootState) =>
    state.tabs.windows
      .filter((window) => Boolean(window.tabId))
      .map((window) => window.tabId)
  );

  const handleTabClick = (tabId: string) => {
    // Find the cluster id for the tab
    const tab = tabs.find((tab) => tab.id === tabId);
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
    <Box
      className="TabBar"
      sx={{
        height: '42px',
        maxHeight: '42px',
        display: 'flex',
        flexDirection: 'row',
        justifyContent: 'space-between',
        gap: 0.5,
        p: 0.5,
        bgcolor: 'background.paper',
      }}
    >
      <GlobalStyles
        styles={{
          ':root': {
            '--GlobalTabBar-height': '43px',
          },
        }}
      />
      {/* Account for apple menu bar with padding */}
      <Stack direction="row" gap={1} sx={{ paddingLeft: isFullscreen ? 0 : 9 }}>
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
          modifiers={[restrictToParentElement, restrictToHorizontalAxis]}
        >
          <SortableContext
            items={tabs.map((tab) => tab.id)}
            strategy={horizontalListSortingStrategy}
          >
            {tabs.map((tab, index) => (
              <>
                {index > 0 && <Divider orientation="vertical" />}
                <HeaderTab
                  tab={tab}
                  handleTabClick={handleTabClick}
                  handleCloseTab={handleCloseTab}
                  clusterId={clusterId!}
                  selectedTabs={selectedTabs}
                />
              </>
            ))}
          </SortableContext>
        </DndContext>
        <Divider orientation="vertical" />
        <Box
          className="Tab"
          onClick={handleCreateNewTab}
          sx={{
            gap: 1.5,
            display: 'flex',
            flexDirection: 'row',
            justifyContent: 'center',
            alignItems: 'center',
            textAlign: 'center',
            borderRadius: 1,
            cursor: 'pointer',
            px: 1.5,
            border: '1px solid',
            borderColor: 'divider',
          }}
        >
          <FaPlus size={12} />
        </Box>
      </Stack>
      {/* Action items */}
      <Stack direction="row" gap={0.5} sx={{ px: 1 }}>
        <Link to="/application">
          <IconButton
            size="md"
            emphasis="ghost"
            color="neutral"
            sx={{ minWidth: 40 }}
          >
            <LuAppWindow />
          </IconButton>
        </Link>
        <Link to="/">
          <IconButton
            size="md"
            emphasis="ghost"
            color="neutral"
            sx={{ minWidth: 40 }}
          >
            <LuHouse />
          </IconButton>
        </Link>

        <Link to="/settings">
          <IconButton
            size="md"
            emphasis="ghost"
            color="neutral"
            sx={{ minWidth: 40 }}
          >
            <LuSettings />
          </IconButton>
        </Link>
      </Stack>
    </Box>
  );
};

export default AppContainerProvider;
