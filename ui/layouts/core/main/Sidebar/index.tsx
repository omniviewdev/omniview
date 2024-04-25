import { useLocation, Link } from 'react-router-dom';

// Material-ui
import GlobalStyles from '@mui/joy/GlobalStyles';
import List from '@mui/joy/List';
import ListItem from '@mui/joy/ListItem';
import Sheet from '@mui/joy/Sheet';
import IconButton from '@mui/joy/IconButton';

// Icons
import Icon from '@/components/icons/Icon';
import { usePluginManager } from '@/hooks/plugin/usePluginManager';
import { Avatar } from '@mui/joy';

// Project imports
import { IsImage } from '@/utils/url';

export default function CoreLayoutSidebar() {
  const { pathname } = useLocation();
  const { plugins } = usePluginManager();

  return (
    <Sheet
      className='CoreLayoutSidebar'
      sx={{
        position: {
          xs: 'fixed',
        },
        transform: {
          xs: 'translateX(calc(100% * (var(--SideNavigation-slideIn, 0) - 1)))',
          lg: 'none',
        },
        transition: 'transform 0.4s',
        zIndex: 1,
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
          // eslint-disable-next-line @typescript-eslint/naming-convention
          ':root': {
            '--CoreLayoutSidebar-width': '60px',
          },
        }}
      />
      {/* Cluster List */}
      <List size='sm' sx={{ '--ListItem-radius': '6px', '--List-gap': '8px', '--ListItem-paddingY': '0px' }}>
        {!plugins.isLoading && plugins.data?.map(({ id, metadata }) => (
          <ListItem key={id}>
            <Link to={`/plugin/${id}`}>
              <IconButton variant={pathname.startsWith(`/plugin/${id}`) ? 'solid' : 'plain'} size='lg'>
                {IsImage(metadata?.icon) ? (
                  <Avatar
                    size='sm'
                    src={metadata.icon}
                    variant='plain'
                    sx={{
                      borderRadius: 4, backgroundColor: 'transparent', objectFit: 'contain', border: 0,
                    }}
                  />
                ) : <Icon name={metadata?.icon || ''} size={44} />}
              </IconButton>
            </Link>
          </ListItem>
        ))}
      </List>
    </Sheet>
  );
}
