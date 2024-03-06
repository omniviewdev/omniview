import { FC, ReactNode, useState } from 'react'

import Sheet from '@mui/joy/Sheet'
import Typography from '@mui/joy/Typography'
import Stack from '@mui/joy/Stack'
import { LuTableProperties } from 'react-icons/lu'
import { GlobalStyles } from '@mui/joy'
import { useLocation } from 'react-router-dom'


/**
 * HeaderTab is a tab that can be displayed in the header bar
 */
type HeaderTab = {
  id: string;
  name: string;
  icon: ReactNode;
}

type Props = {
  /** The cluster context ID */
  clusterId: string;
}


const HeaderTabBar: FC<Props> = ({ }) => {
  const [tabs, _setTabs] = useState<HeaderTab[]>([{ id: 'index', name: 'Resources', icon: <LuTableProperties /> }]);
  const pathname = useLocation();

  console.log(pathname, tabs)

  const selectedTab = tabs.find((tab) => tab.id === pathname.pathname) ? pathname.pathname : 'index';

  return (
    <Sheet
      className="TabBar"
      color='neutral'
      sx={{
        height: '50px',
        maxHeight: '50px',
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
            '--HeaderTabBar-height': '50px',
          },
        }}
      />
      <Stack direction='row' gap={1}>
        {tabs.map((tab) => (
          <Sheet
            key={tab.id}
            className="Tab"
            variant={selectedTab ? 'outlined' : 'plain'}
            sx={{
              gap: 2,
              display: 'flex',
              flexDirection: 'row',
              justifyContent: 'flex-start',
              alignItems: 'center',
              textAlign: 'center',
              minWidth: 300,
              borderRadius: 'sm',
              cursor: 'pointer',
              border: 'divider',
              backgroundColor: selectedTab !== tab.id ? '#1E1E1E' : undefined,
              pl: 2,
            }}
          >
            {tab.icon}
            <Typography level='title-sm'>{tab.name}</Typography>
          </Sheet>
        ))}
      </Stack>
    </Sheet>
  );
}

export default HeaderTabBar
