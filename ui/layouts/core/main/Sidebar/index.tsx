import { useLocation, Link } from 'react-router-dom';

// Material-ui
import GlobalStyles from '@mui/joy/GlobalStyles';
import Sheet from '@mui/joy/Sheet';
import Tabs from '@mui/joy/Tabs';
import Tab, { tabClasses } from '@mui/joy/Tab';
import TabList from '@mui/joy/TabList';

// Icons
import Icon from '@/components/icons/Icon';
import { usePluginManager } from '@/hooks/plugin/usePluginManager';
import { Avatar } from '@mui/joy';

// Project imports
import { IsImage } from '@/utils/url';

export default function CoreLayoutSidebar() {
  const { pathname } = useLocation();
  const { plugins } = usePluginManager();
  var matched = pathname.match(/^\/_plugin\/([A-Za-z0-9]+).*/)?.[1] || '';

  return (
    <Sheet
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
      <Tabs
        size='sm'
        aria-label="Sidebar Tabs"
        orientation="vertical"
        value={matched}
        sx={{
          "--Tab-indicatorThickness": "3px"
        }}
      >
        <TabList
          sx={{
            justifyContent: 'center',
            [`&& .${tabClasses.root}`]: {
              bgcolor: 'transparent',
              '&:hover': {
                bgcolor: 'transparent',
              },
              [`&.${tabClasses.selected}`]: {
                color: 'primary.plainColor',
                '&::after': {
                  bgcolor: 'primary.500',
                },
              },
            },
          }}
        >
          {!plugins.isLoading && plugins.data?.map(({ id, metadata }) => (
            <Tab
              key={id}
              value={id}
              indicatorPlacement='left'
              sx={{
                px: 1,
                py: 1.2,
                width: 'var(--CoreLayoutSidebar-width)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                WebkitUserSelect: 'none',
                WebkitUserDrag: 'none',
              }}
              component={Link}
              to={`/_plugin/${id}`}
              style={{
                textDecoration: 'none',
                color: 'inherit',
              }}
            >
              {IsImage(metadata?.icon) ? (
                <Avatar
                  size='sm'
                  src={metadata.icon}
                  variant='plain'
                  sx={{
                    borderRadius: 4,
                    backgroundColor: 'transparent',
                    objectFit: 'contain',
                    border: 0,
                    width: '30px',
                    height: '30px',
                  }}
                />
              ) : <Icon name={metadata?.icon || ''} size={26} />}
            </Tab>
          ))}
        </TabList>
      </Tabs>
    </Sheet>
  );
}
