import { FC, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom';

// dnd-kit
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, DragEndEvent } from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, horizontalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { restrictToHorizontalAxis, restrictToParentElement } from '@dnd-kit/modifiers';

import { CSS } from '@dnd-kit/utilities';

// types
import { Tab } from '@/store/tabs/types';

// material-ui
import { CssVarsProvider } from '@mui/joy/styles';
import CssBaseline from '@mui/joy/CssBaseline';
import Box from '@mui/joy/Box';
import Typography from '@mui/joy/Typography';
import GlobalStyles from '@mui/joy/GlobalStyles';
import Sheet from '@mui/joy/Sheet';
import Stack from '@mui/joy/Stack';
import AspectRatio from '@mui/joy/AspectRatio';
import Divider from '@mui/joy/Divider';
import IconButton from '@mui/joy/IconButton';


// redux
import type { RootState } from '@/store/store'
import { useSelector, useDispatch } from 'react-redux'
import { handleAddTab, handleBrowserResize, handleRemoveTab, handleReorderTabsByID } from '@/store/tabs/slice';

// icons
import { LuAppWindow, LuBox, LuHome, LuSettings, LuX } from "react-icons/lu";
import { FaPlus } from "react-icons/fa";
import { WindowIsFullscreen } from '@runtime/runtime';

type Props = {
  children?: React.ReactNode;
}

const AppContainerProvider: FC<Props> = ({ children }) => {
  const dispatch = useDispatch();

  function reportWindowSize() {
    console.log("new window size", { width: window.innerWidth, height: window.innerHeight })
    dispatch(handleBrowserResize({ width: window.innerWidth, height: window.innerHeight }));
  }

  window.onresize = reportWindowSize;

  return (
    <CssVarsProvider disableTransitionOnChange>
      <CssBaseline />
      <Box sx={{ display: 'flex', minHeight: '100dvh', flexDirection: 'column' }}>
        <HeaderTabBar />
        <Divider />
        <Box
          component="main"
          className="MainContainer"
          // make fill entire width and height of the screen
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
    </CssVarsProvider>
  );
}

type HeaderTabProps = {
  tab: Tab;
  handleTabClick: (tabId: string) => void;
  handleCloseTab: (tabId: string) => void;
  clusterId: string;
  selectedTabs: string[];
}

const HeaderTab: FC<HeaderTabProps> = ({ tab, handleTabClick, handleCloseTab, clusterId, selectedTabs }) => {
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


  return (
    <Sheet
      key={tab.id}
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className="Tab"
      variant='plain'
      onClick={() => handleTabClick(tab.id)}
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
      }}
    >
      {!!tab.icon && typeof tab.icon === 'string' ?
        <AspectRatio ratio="1" sx={{ width: 22, borderRadius: 4 }}>
          <img
            src={tab.icon}
            srcSet={`${tab.icon} 2x`}
            loading="lazy"
            alt=""
          />
        </AspectRatio>
        : <LuBox />
      }
      <Typography level='title-sm' minWidth={100} noWrap flexGrow={1} textAlign={'start'}>{tab.label}</Typography>
      <IconButton
        variant='plain'
        size='sm'
        onClick={() => handleCloseTab(tab.id)}
        sx={{ minHeight: 0, minWidth: 0, padding: 0.5, backgroundColor: 'transparent' }}
      >
        <LuX />
      </IconButton>
    </Sheet>
  )
}

type HeaderTabBarProps = {}

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
      dispatch(handleReorderTabsByID({ tabId1: active.id as string, tabId2: over.id as string, strategy: 'shift' }));
    }
  };

  useEffect(() => {
    async function isFullscreen() {
      setIsFullscreen(await WindowIsFullscreen())
    }
    isFullscreen()
  }, [window.innerWidth, window.innerHeight])

  const dispatch = useDispatch();
  const tabs = useSelector((state: RootState) => state.tabs.tabs);
  const selectedTabs = useSelector((state: RootState) => state.tabs.windows.filter((window) => !!window.tabId).map((window) => window.tabId));


  const handleTabClick = (tabId: string) => {
    // find the cluster id for the tab 
    const tab = tabs.find((tab) => tab.id === tabId);
    if (!tab?.cluster) {
      return;
    }
    navigate(`/explorer/${btoa(tab.cluster)}/pods`);
  }

  const handleCreateNewTab = () => {
    dispatch(handleAddTab({ cluster: 'gc-int', label: 'gc-int' }))
  }

  const handleCloseTab = (tabId: string) => {
    dispatch(handleRemoveTab(tabId));
  }

  return (
    <Sheet
      className="TabBar"
      sx={{
        height: '42px',
        maxHeight: '42px',
        display: 'flex',
        flexDirection: 'row',
        justifyContent: 'space-between',
        gap: 0.5,
        p: 0.5,
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
      <Stack direction='row' gap={1} paddingLeft={isFullscreen ? 0 : 9}>
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
          modifiers={[restrictToParentElement, restrictToHorizontalAxis]} >
          <SortableContext items={tabs.map((tab) => tab.id)} strategy={horizontalListSortingStrategy}>
            {tabs.map((tab, index) => (
              <>
                {index > 0 && <Divider orientation='vertical' />}
                <HeaderTab tab={tab} handleTabClick={handleTabClick} handleCloseTab={handleCloseTab} clusterId={clusterId as string} selectedTabs={selectedTabs} />
              </>
            ))}
          </SortableContext>
        </DndContext>
        <Divider orientation='vertical' />
        <Sheet
          className="Tab"
          variant='outlined'
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
          }}
        >
          <FaPlus size={12} />
        </Sheet>
      </Stack>
      {/* Action items */}
      <Stack direction='row' gap={0.5} px={1}>

        <Link to="/application">
          <IconButton size='md' variant='plain' color='neutral' sx={{ minWidth: 40 }}>
            <LuAppWindow />
          </IconButton>
        </Link>
        <Link to="/">
          <IconButton size='md' variant='plain' color='neutral' sx={{ minWidth: 40 }}>
            <LuHome />
          </IconButton>
        </Link>

        <Link to="/settings">
          <IconButton size='md' variant='plain' color='neutral' sx={{ minWidth: 40 }}>
            <LuSettings />
          </IconButton>
        </Link>
      </Stack>
    </Sheet>
  );
}

export default AppContainerProvider;
