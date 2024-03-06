import React from 'react';

// material-ui
import Box from '@mui/joy/Box';
import Sheet from '@mui/joy/Sheet';
import IconButton from '@mui/joy/IconButton';
import Typography from '@mui/joy/Typography';
import Divider from '@mui/joy/Divider';
import Stack from '@mui/joy/Stack';

// icons
import { LuPlus, LuTerminalSquare, LuX, LuMinimize } from 'react-icons/lu';

// terminal manager
import { ListSessions, StartSession, TerminateSession } from '@api/services/TerminalManager';
import { services } from '@api/models';
import TerminalView from '@/components/terminal/TerminalView';
import { GlobalStyles } from '@mui/joy';
import { useParams } from 'react-router-dom';

type Props = {}

type Tab = {
  /** The id of the tab. This will typically be the id of the underlying resource */
  id: string;
  /** The type of tab, currently only terminal tabs supported */
  type: 'terminal' | 'log' | 'file';
  /** The content of the tab, (currently only terminal tabs suppported) */
  content: services.TerminalSessionDetails;
}

type TabBarProps = {
  /** The cluster ID */
  clusterID: string;
  /** The tabs to display */
  tabs: Tab[];
  /** Set the tabs */
  setTabs: (tabs: Tab[]) => void;
  /** The currently selected tab */
  selectedTab: string;
  /** Set the selected tab */
  setSelectedTab: (id: string) => void;
  /** The height of the tab bar */
  height: number;
}

/**
* Provides a tab bar for the lower context area.
*/
const TabBar: React.FC<TabBarProps> = ({ tabs, setTabs, selectedTab, setSelectedTab, height, clusterID }) => {
  React.useEffect(() => {
    ListSessions().then((sessions) => {
      setTabs(sessions.map((session) => ({ id: session.id, type: 'terminal', content: session })));
    });
  }, [])

  /**
   * Kill a tab by ID
   */
  const closeTab = (id: string) => {
    const tab = tabs.find((tab => tab.id === id))
    if (tab && tab.type === 'terminal') {
      TerminateSession(tab.content.id).then(() => {
        setSelectedTab('');
        ListSessions().then((sessions) => {
          setTabs(sessions.map((session) => ({ id: session.id, type: 'terminal', content: session })));
        });
      });
    }
  }

  /**
   * Create a new tab
   */
  const newTab = ({ type }: { type: string }) => {
    if (type === 'terminal') {
      StartSession([], { kubeconfig: '', context: clusterID, labels: {} }).then((session) => {
        setSelectedTab(session);
        ListSessions().then((sessions) => {
          setTabs(sessions.map((session) => ({ id: session.id, type: 'terminal', content: session })));
        });
      });
    }
  }

  return (
    <Box
      className="TabBar"
      border="1px solid transparent"
      sx={{
        height,
        maxHeight: height,
        display: 'flex',
        flexDirection: 'row',
        justifyContent: 'space-between',
        gap: 0.5,
        p: 0.5,
      }}
    >
      <Stack direction='row' gap={0.5}>
        <IconButton
          variant='soft'
          size='md'
          sx={{ minHeight: 0, minWidth: 0, py: 1, px: 1.5 }}
          onClick={() => newTab({ type: 'terminal' })}
        >
          <LuPlus />
        </IconButton>
        {tabs.map((tab) => (
          <Sheet
            key={tab.id}
            className="Tab"
            variant="outlined"
            sx={{
              display: 'flex',
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
              minWidth: 150,
              pl: 1,
              pr: 0.25,
              py: 0.25,
              borderRadius: 'sm',
              cursor: 'pointer',
              border: selectedTab === tab.id ? '1px solid' : 'divider',
              '&:hover': {
                border: selectedTab === tab.id ? '1px solid' : '0.5px solid',
              },
            }}
            onClick={() => setSelectedTab(tab.content.id)}
          >
            <Typography level='body-sm'><LuTerminalSquare style={{ marginRight: 8 }} />{tab.id}</Typography>
            <IconButton variant='soft' size='sm' onClick={() => closeTab(tab.id)} sx={{ minHeight: 0, minWidth: 0, padding: 0.5 }} >
              <LuX />
            </IconButton>
          </Sheet>
        ))}
      </Stack>
      {/* End actions */}
      <Stack direction='row' gap={0.5}>
        <IconButton
          variant='soft'
          size='md'
          sx={{ minHeight: 0, minWidth: 0, py: 1, px: 1.5 }}
          onClick={() => setSelectedTab('')}
        >
          <LuMinimize />
        </IconButton>
      </Stack>
    </Box>
  );
}

TabBar.whyDidYouRender = true;

/**
* Provides a resizable drawer for the lower portion of the layout.
* This area houses various width-priority components, such as the terminal provider,
* the log provider, and other injectable lower context components provided
* by third party plugins.
*/
const BottomDrawer: React.FC<Props> = ({ }) => {
  const { clusterID } = useParams<{ clusterID: string }>();

  const [height, _setHeight] = React.useState<number>(400);
  const [tabBarHeight, _setTabBarHeight] = React.useState<number>(42);

  const [tabs, setTabs] = React.useState<Tab[]>([]);
  const [selectedTab, setSelectedTab] = React.useState<string>('');

  return (
    <>
      <GlobalStyles
        styles={{
          ':root': {
            '--LowerContextMenu-height': `${!!selectedTab ? height + tabBarHeight : tabBarHeight}px`,
          },
        }}
      />
      <Box
        className="LowerContext"
        sx={{
          zIndex: 10000,
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          maxHeight: height + tabBarHeight,
          overflow: 'hidden',
        }}
      >
        <Sheet
          className="LowerContextContainer"
          variant="plain"
          sx={{
            display: { xs: 'none', sm: 'initial' },
            backgroundColor: 'background.surface',
            width: '100%',
            // borderRadius: 'sm',
            flexShrink: 1,
            flexGrow: 1,
            overflow: 'hidden',
            minHeight: 0,
          }}
        >
          <TabBar clusterID={clusterID as string} tabs={tabs} setTabs={setTabs} selectedTab={selectedTab} setSelectedTab={setSelectedTab} height={tabBarHeight} />
          <Divider />
          {/* Context window */}
          {selectedTab !== '' && tabs.find((tab) => tab.id === selectedTab)?.type === 'terminal' && (
            <TerminalView sessionId={selectedTab} height={height} />
          )}
        </Sheet>
      </Box>
    </>
  )
}

BottomDrawer.whyDidYouRender = true;

export default BottomDrawer
