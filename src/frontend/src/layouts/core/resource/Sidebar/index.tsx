import React from 'react';
import { Link, useLocation } from 'react-router-dom';

// material-ui
import Box from '@mui/joy/Box';
import Sheet from '@mui/joy/Sheet';
import List from '@mui/joy/List';
import ListItem from '@mui/joy/ListItem';
import ListItemContent from '@mui/joy/ListItemContent';
import ListItemDecorator from '@mui/joy/ListItemDecorator';
import ListItemButton from '@mui/joy/ListItemButton';
import Typography from '@mui/joy/Typography';
import GlobalStyles from '@mui/joy/GlobalStyles'
import IconButton from '@mui/joy/IconButton'

// icons
import { LuNetwork, LuServer, LuContainer, LuDatabase, LuCloudLightning, LuGroup, LuLayoutDashboard, LuCpu, LuFileJson2, LuShield } from "react-icons/lu";
import KeyboardArrowDown from '@mui/icons-material/KeyboardArrowDown'

// project imports
import { closeSidebar } from '@/utils';

const menuItems = [
  {
    label: 'Dashboard',
    name: 'dashboard',
    icon: <LuLayoutDashboard />,
    children: [],
  },
  {
    label: 'Nodes',
    name: 'nodes',
    icon: <LuCpu />,
    children: [],
  },
  {
    label: 'Pods',
    name: 'pods',
    icon: <LuContainer />,
    children: [],
  },
  {
    label: 'Events',
    name: 'events',
    icon: <LuCloudLightning />,
    children: [],
  },
  {
    label: 'Namespaces',
    name: 'namespaces',
    icon: <LuGroup />,
    children: [],
  },
  {
    label: 'Compute',
    name: 'compute',
    icon: <LuServer />,
    children: [
      {
        label: 'Deployments',
        name: 'deployments',
      },
      {
        label: 'StatefulSets',
        name: 'statefulsets',
      },
      {
        label: 'DaemonSets',
        name: 'daemonsets',
      },
      {
        label: 'ReplicaSets',
        name: 'replicasets',
      },
      {
        label: 'Jobs',
        name: 'jobs',
      },
      {
        label: 'CronJobs',
        name: 'cronjobs',
      }
    ]
  },
  {
    label: 'Network',
    name: 'network',
    icon: <LuNetwork />,
    children: [
      {
        label: 'Services',
        name: 'services',
      },
      {
        label: 'Ingresses',
        name: 'ingresses',
      },
      {
        label: 'Ingress Classes',
        name: 'ingressclasses',
      },
      {
        label: 'Endpoints',
        name: 'endpoints',
      },
      {
        label: 'Network Policies',
        name: 'networkpolicies',
      }
    ]
  },
  {
    label: 'Storage',
    name: 'storage',
    icon: <LuDatabase />,
    children: [
      {
        label: 'Persistent Volumes',
        name: 'persistentvolumes',
      },
      {
        label: 'Persistent Volume Claims',
        name: 'persistentvolumeclaims',
      },
      {
        label: 'Storage Classes',
        name: 'storageclasses',
      },
      {
        label: 'Volume Attachments',
        name: 'volumeattachments',
      }
    ]
  },
  {
    label: 'Configuration',
    name: 'configuration',
    icon: <LuFileJson2 />,
    children: [
      {
        label: 'Config Maps',
        name: 'configmaps',
      },
      {
        label: 'Secrets',
        name: 'secrets',
      },
    ]
  },
  {
    label: 'Security',
    name: 'security',
    icon: <LuShield />,
    children: [
      {
        label: 'Roles',
        name: 'roles',
      },
      {
        label: 'Role Bindings',
        name: 'rolebindings',
      },
      {
        label: 'Cluster Roles',
        name: 'clusterroles',
      },
      {
        label: 'Cluster Role Bindings',
        name: 'clusterrolebindings',
      },
      {
        label: 'Service Accounts',
        name: 'serviceaccounts',
      },
    ]
  },
]


const ResourceSidebar: React.FC = () => {
  let location = useLocation();

  return (
    <>
      <Box
        className="ResourceSidebar-overlay"
        sx={{
          position: 'fixed',
          zIndex: 9998,
          bottom: 0,
          left: 0,
          width: '100vw',
          height: 'calc(100dvh - var(--CoreLayoutHeader-height))',
          opacity: 'var(--SideNavigation-slideIn)',
          backgroundColor: 'var(--joy-palette-background-backdrop)',
          transition: 'opacity 0.4s',
          transform: {
            xs: 'translateX(calc(100% * (var(--SideNavigation-slideIn, 0) - 1) + var(--SideNavigation-slideIn, 0) * var(--CoreLayoutSidebar-width, 0px)))',
            lg: 'translateX(-100%)',
          },
        }}
        onClick={() => closeSidebar()}
      />
      <Sheet
        className="ResourceSidebar"
        color="neutral"
        sx={{
          position: {
            xs: 'fixed',
          },
          transform: {
            xs: 'translateX(calc(100% * (var(--SideNavigation-slideIn, 0) - 1) + var(--SideNavigation-slideIn, 0) * var(--CoreLayoutSidebar-width, 0px)))',
            lg: 'none',
          },
          transition: 'transform 0.4s',
          zIndex: 9999,
          height: 'calc(100dvh - var(--CoreLayoutHeader-height))',
          maxWidth: 'var(--ResourceSidebar-width)',
          bottom: 0,
          p: 1,
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 1,
          borderRight: '1px solid',
          borderColor: 'divider',
        }}
      >
        <GlobalStyles
          styles={{
            ':root': {
              '--ResourceSidebar-width': '211px',
            },
          }}
        />
        <List
          size="sm"
          sx={{
            overflowY: 'scroll',
            width: '100%',
            // make the scrollbar invisible
            scrollbarWidth: 'none',
            msOverflowStyle: 'none',
            '&::-webkit-scrollbar': {
              display: 'none',
            },
            pt: 0,
            pb: 0,
            '--ListItem-radius': '6px',
            '--ListItemDecorator-size': '1.5rem',
          }}
        >
          {menuItems.map((item) => {
            // bogus to get it to work eventually
            const parentLink = `${location.pathname}/${item.name}`

            return (
              <NavWrapper item={item} key={item.name} location={location.pathname}>
                <ListItem
                  nested={!!item.children?.length}
                  endAction={
                    !!item.children?.length && <IconButton
                      variant="plain"
                      size="sm"
                      color="neutral"
                    >
                      <KeyboardArrowDown
                        sx={{ transform: 'initial' }}
                      />
                    </IconButton>
                  }
                >
                  <ListItemButton selected={location.pathname === parentLink}>
                    <ListItemDecorator>
                      {item.icon}
                    </ListItemDecorator>
                    <ListItemContent>
                      <Typography level='title-sm' fontWeight={500}>{item.label}</Typography>
                    </ListItemContent>
                  </ListItemButton>
                </ListItem>
                {item.children.map((child) => (
                  <Link to={`${parentLink}/${child.name}`} key={child.name} style={{ textDecoration: 'none' }} >
                    <ListItem nested>
                      <ListItemButton selected={location.pathname === `${parentLink}/${child.name}`}>
                        <ListItemDecorator sx={{ marginLeft: 1 }} />
                        <ListItemContent>
                          <Typography level='title-sm'>{child.label}</Typography>
                        </ListItemContent>
                      </ListItemButton>
                    </ListItem>
                  </Link>
                ))}
              </NavWrapper>
            )
          }
          )}
        </List>
      </Sheet>
    </>
  );
}

const NavWrapper = ({ item, children, location }: { item: any, children: any, location: string }) => {
  if (!!item?.children?.length) {
    return children
  }
  return <Link to={`${location}/${item.name}`} key={item.name} style={{ textDecoration: 'none' }}>{children}</Link>
}

export default ResourceSidebar
