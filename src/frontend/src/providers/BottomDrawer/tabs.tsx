import React from 'react';

// material-ui
import IconButton from '@mui/joy/IconButton';
import Tabs from '@mui/joy/Tabs';
import TabList from '@mui/joy/TabList';
import Tab from '@mui/joy/Tab';
import Typography from '@mui/joy/Typography';
import Stack from '@mui/joy/Stack';

// provider
import { type BottomDrawerTab } from '@/providers/BottomDrawer/types';

// project imports
import Icon from '@/components/icons/Icon';
import { LuPlus, LuX } from 'react-icons/lu';
import useBottomDrawer from '@/hooks/useBottomDrawer';
import { Divider } from '@mui/joy';
import { ListSessions, StartSession } from '@api/terminal/TerminalManager';
import { terminal } from '@api/models';


/**
 * Renders the tabs for the bottom drawer.
 */
const BottomDrawerTabs: React.FC = () => {
  const { tabs, focused, focusTab, closeTab, createTab, createTabs } = useBottomDrawer();

  // eslint-disable-next-line @typescript-eslint/ban-types -- null is required by onChange
  const handleChange = (_event: React.SyntheticEvent | null, newValue: string | number | null) => {
    if (typeof newValue === 'number') {
      focusTab({ index: newValue });
    }
  };

  const handleCreate = (variant: 'terminal' | 'browser') => {
    switch (variant) {
      case 'terminal':
        StartSession([], terminal.TerminalSessionOptions.createFrom({}))
          .then(session => {
            createTab({
              id: session,
              title: `Session ${tabs.length + 1}`, 
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

  React.useEffect(() => {
    ListSessions()
      .then(sessions => {
        console.log('sessions', sessions);
        let newtabcount = 0;

        const newTabs: BottomDrawerTab[] = [];

        // find and upsert any missing sessions where the id doesn't exist
        sessions.forEach(session => {
          // const existing = tabs.find(tab => tab.id === session.id);
          // if (existing) {
          //   return undefined;
          // }

          newTabs.push({
            id: session.id,
            title: `Session ${tabs.length + newtabcount++}`,
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
        variant="outlined"
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
      {tabs.length === 0 
        ? <Divider orientation="vertical"/>
        :
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
              <BottomDrawerTabComponent 
                key={tab.id} 
                {...tab} 
                index={index} 
                selected={focused === index}
                onRemove={() => {
                  closeTab({ index }); 
                }} 
              />
            ))}
          </TabList>
        </Tabs>
      }
    </Stack>
  );
};

type BottomDrawerTabProps = BottomDrawerTab & {
  index: number;
  selected: boolean;
  onRemove?: () => void;
};

const BottomDrawerTabComponent: React.FC<BottomDrawerTabProps> = ({ id, title, icon, selected, onRemove }) => (
  <Tab 
    key={`bottom-drawer-tab-${id}`} 
    variant='plain'
    sx={{
      pt: 0,
      pb: selected ? 0.25 : 0,
      pr: 0,
      pl: 1,
      alignItems: 'center',
      minWidth: 150,
      flex: 'none', 
      scrollSnapAlign: 'start',
      borderRightColor: 'divider',
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
        startDecorator={
          icon !== undefined ? (
            typeof icon === 'string' ? <Icon name={icon} size={14} /> : icon
          ) : null
        }
      >
        {title}
      </Typography>
      <IconButton 
        size="sm" 
        variant="plain" 
        onClick={onRemove}
        sx={{
          minHeight: 28,
          minWidth: 28,
        }}
      >
        <LuX size={16} />
      </IconButton>
    </Stack>
  </Tab>
);

export default BottomDrawerTabs;
