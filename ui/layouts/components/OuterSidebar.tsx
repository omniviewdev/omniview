import { useLocation } from 'react-router-dom';

// Material-ui
import GlobalStyles from '@mui/joy/GlobalStyles';
import List from '@mui/joy/List';
import ListItem from '@mui/joy/ListItem';
import Sheet from '@mui/joy/Sheet';
import IconButton from '@mui/joy/IconButton';

// Icons
import { LuBoxes } from 'react-icons/lu';
import { PiGraphBold } from 'react-icons/pi';

// Assets
// import KubernetesLogo from '../../assets/icons/KubernetesLogo';

const sidebarItems = [
  {
    name: 'explorer',
    logo: LuBoxes,
  },
  {
    name: 'graphql',
    logo: PiGraphBold,
  },
];

export default function FirstSidebar() {
  const { pathname } = useLocation();

  return (
    <Sheet
      className='FirstSidebar'
      sx={{
        position: {
          xs: 'fixed',
        },
        transform: {
          xs: 'translateX(calc(100% * (var(--SideNavigation-slideIn, 0) - 1)))',
          lg: 'none',
        },
        transition: 'transform 0.4s',
        zIndex: 10000,
        height: 'calc(100dvh - var(--CoreLayoutHeader-height))',
        maxWidth: 'var(--FirstSidebar-width)',
        bottom: 0,
        p: 0.5,
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 0,
        borderRight: '1px solid',
        borderColor: 'divider',
      }}
    >
      <GlobalStyles
        styles={{
          ':root': {
            '--FirstSidebar-width': '60px',
          },
        }}
      />
      {/* Cluster List */}
      <List size='sm' sx={{ '--ListItem-radius': '6px', '--List-gap': '8px', '--ListItem-paddingY': '0px' }}>
        {sidebarItems.map(item => (
          <ListItem key={item.name}>
            <IconButton variant={pathname.startsWith(`/${item.name}`) ? 'solid' : 'plain'} size='lg'>
              <item.logo size={25} />
            </IconButton>
          </ListItem>
        ))}
      </List>
    </Sheet>
  );
}
