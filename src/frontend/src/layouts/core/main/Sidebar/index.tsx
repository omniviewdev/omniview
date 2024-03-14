import { useLocation, Link } from 'react-router-dom';

// material-ui
import GlobalStyles from '@mui/joy/GlobalStyles';
import List from '@mui/joy/List';
import ListItem from '@mui/joy/ListItem';
import Sheet from '@mui/joy/Sheet';
import IconButton from '@mui/joy/IconButton';

// icons
import { LuBoxes, LuUnplug } from "react-icons/lu";
import { PiGraphBold } from "react-icons/pi";
import { useSettingsNamespace } from '@/hooks/useSettings';
import Icon from '@/components/icons/Icon';


const sidebarItems = [
  {
    name: 'explorer',
    logo: LuBoxes,
  },
  {
    name: 'plugins',
    logo: LuUnplug,
  },
  {
    name: 'graphql',
    logo: PiGraphBold,
  },
];

export default function CoreLayoutSidebar() {
  const { pathname } = useLocation();
  const clouds = useSettingsNamespace('clouds')
  const orchestrators = useSettingsNamespace('orchestrators')

  return (
    <Sheet
      className="CoreLayoutSidebar"
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
        maxWidth: 'var(--CoreLayoutSidebar-width)',
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
            '--CoreLayoutSidebar-width': '60px',
          },
        }}
      />
      {/* Cluster List */}
      <List size="sm" sx={{ '--ListItem-radius': '6px', '--List-gap': '8px', '--ListItem-paddingY': '0px' }}>
        {sidebarItems.map((item) => (
          <ListItem key={item.name}>
            <Link to={`/${item.name}`}>
              <IconButton variant={pathname.startsWith(`/${item.name}`) ? 'solid' : 'plain'} size="lg">
                <item.logo size={25} />
              </IconButton>
            </Link>
          </ListItem>
        ))}
        {Object.values(clouds.sections).map((cloud) => (
          <ListItem key={cloud.id}>
            <Link to={`/${cloud.id}`}>
              <IconButton variant={pathname.startsWith(`/${cloud.id}`) ? 'solid' : 'plain'} size="lg">
                <Icon name={cloud.icon} size={25} />
              </IconButton>
            </Link>
          </ListItem>
        ))}
        {Object.values(orchestrators.sections).map((orchestrator) => (
          <ListItem key={orchestrator.id}>
            <Link to={`/${orchestrator.id}`}>
              <IconButton variant={pathname.startsWith(`/${orchestrator.id}`) ? 'solid' : 'plain'} size="lg">
                <Icon name={orchestrator.icon} size={25} />
              </IconButton>
            </Link>
          </ListItem>
        ))}
      </List>
    </Sheet>
  );
}
