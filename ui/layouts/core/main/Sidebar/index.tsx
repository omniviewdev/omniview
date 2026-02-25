import { useLocation, Link } from 'react-router-dom';

// Material-ui
import GlobalStyles from '@mui/material/GlobalStyles';
import Box from '@mui/material/Box';
import MuiTabs from '@mui/material/Tabs';
import MuiTab from '@mui/material/Tab';
import Avatar from '@mui/material/Avatar';

// Icons
import Icon from '@/components/icons/Icon';
import { usePluginManager } from '@/hooks/plugin/usePluginManager';

// Project imports
import { IsImage } from '@/utils/url';

export default function CoreLayoutSidebar() {
  const { pathname } = useLocation();
  const { plugins } = usePluginManager();
  var matched = pathname.match(/^\/_plugin\/([A-Za-z0-9-]+).*/)?.[1] || '';

  return (
    <Box
      className='CoreLayoutSidebar'
      sx={{
        position: 'fixed',
        transform: {
          xs: 'translateX(calc(100% * (var(--SideNavigation-slideIn, 0) - 1)))',
          lg: 'none',
        },
        transition: 'transform 0.4s',
        zIndex: 1,
        height: 'calc(100dvh - var(--CoreLayoutHeader-height) - var(--CoreLayoutFooter-height))',
        width: 'var(--CoreLayoutSidebar-width)',
        minWidth: 'var(--CoreLayoutSidebar-width)',
        maxWidth: 'var(--CoreLayoutSidebar-width)',
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 0,
        borderRight: '1px solid',
        borderColor: 'divider',
        bgcolor: 'background.paper',
      }}
    >
      <GlobalStyles
        styles={{
          // eslint-disable-next-line @typescript-eslint/naming-convention
          ':root': {
            '--CoreLayoutSidebar-width': '48px',
          },
        }}
      />

      {/* Dynamic Plugins */}
      <MuiTabs
        aria-label="Sidebar Tabs"
        orientation="vertical"
        value={matched || false}
        sx={{
          '& .MuiTabs-indicator': {
            left: 0,
            width: '3px',
          },
        }}
      >
        {!plugins.isLoading && plugins.data?.map(({ id, metadata }) => (
          <MuiTab
            key={id}
            value={id}
            sx={{
              px: 1,
              py: 1.2,
              minWidth: 'var(--CoreLayoutSidebar-width)',
              width: 'var(--CoreLayoutSidebar-width)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              WebkitUserSelect: 'none',
            }}
            component={Link}
            to={`/_plugin/${id}`}
            icon={
              IsImage(metadata?.icon) ? (
                <Avatar
                  src={metadata.icon}
                  variant='square'
                  sx={{
                    borderRadius: 1,
                    backgroundColor: 'transparent',
                    objectFit: 'contain',
                    border: 0,
                    width: '30px',
                    height: '30px',
                  }}
                />
              ) : <Icon name={metadata?.icon || ''} size={26} />
            }
          />
        ))}
      </MuiTabs>
    </Box>
  );
}
