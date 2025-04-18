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
  var matched = pathname.match(/^\/plugin\/([A-Za-z0-9]+).*/)?.[1] || '';

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
        // p: 0.5,
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
                p: 1,
                width: 'var(--CoreLayoutSidebar-width)',
                display: 'flex',
              }}
            >
              <Link
                to={`/plugin/${id}`}
                style={{
                  display: 'flex',
                  width: 'var(--CoreLayoutSidebar-width)',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
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
              </Link>
            </Tab>
          ))}
        </TabList>
      </Tabs>

      {/* Dynamic Plugins */}
      {/* <List size='sm' sx={{ '--ListItem-radius': '6px', '--List-gap': '8px', '--ListItem-paddingY': '0px' }}> */}
      {/*   {!plugins.isLoading && plugins.data?.map(({ id, metadata }) => ( */}
      {/*     <ListItem key={id}> */}
      {/*       <Link to={`/plugin/${id}`}> */}
      {/*         <IconButton variant={pathname.startsWith(`/plugin/${id}`) ? 'solid' : 'plain'} size='lg'> */}
      {/*           {IsImage(metadata?.icon) ? ( */}
      {/*             <Avatar */}
      {/*               size='sm' */}
      {/*               src={metadata.icon} */}
      {/*               variant='plain' */}
      {/*               sx={{ */}
      {/*                 borderRadius: 4, backgroundColor: 'transparent', objectFit: 'contain', border: 0, */}
      {/*               }} */}
      {/*             /> */}
      {/*           ) : <Icon name={metadata?.icon || ''} size={44} />} */}
      {/*         </IconButton> */}
      {/*       </Link> */}
      {/*     </ListItem> */}
      {/*   ))} */}
      {/**/}
      {/*   <ListItem key={'trivy'}> */}
      {/*     <Link to={'/trivy'}> */}
      {/*       <IconButton variant={pathname.startsWith('/trivy') ? 'solid' : 'plain'} size='lg'> */}
      {/*         <Avatar */}
      {/*           size='sm' */}
      {/*           src={'https://raw.githubusercontent.com/aquasecurity/trivy-docker-extension/main/trivy.svg'} */}
      {/*           variant='plain' */}
      {/*           sx={{ */}
      {/*             borderRadius: 4, backgroundColor: 'transparent', objectFit: 'contain', border: 0, */}
      {/*           }} */}
      {/*         /> */}
      {/*       </IconButton> */}
      {/*     </Link> */}
      {/*   </ListItem> */}
      {/* </List> */}
    </Sheet>
  );
}
