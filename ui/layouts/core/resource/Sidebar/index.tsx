import React from 'react';
import { Link, useLocation } from 'react-router-dom';

// Material-ui
import Box from '@mui/material/Box';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemText from '@mui/material/ListItemText';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemButton from '@mui/material/ListItemButton';
import GlobalStyles from '@mui/material/GlobalStyles';
import IconButton from '@mui/material/IconButton';

// Icons
import {
  LuNetwork, LuServer, LuContainer, LuDatabase, LuCloudLightning, LuGroup, LuLayoutDashboard, LuCpu, LuFileJson2, LuShield,
} from 'react-icons/lu';
import KeyboardArrowDown from '@mui/icons-material/KeyboardArrowDown';

// Project imports
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
      },
    ],
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
      },
    ],
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
      },
    ],
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
    ],
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
    ],
  },
];

const ResourceSidebar: React.FC = () => {
  const location = useLocation();

  return (
    <>
      <Box
        className='ResourceSidebar-overlay'
        sx={{
          position: 'fixed',
          zIndex: 9998,
          bottom: 0,
          left: 0,
          width: '100vw',
          height: 'calc(100dvh - var(--CoreLayoutHeader-height))',
          opacity: 'var(--SideNavigation-slideIn)',
          backgroundColor: 'rgba(0, 0, 0, 0.5)',
          transition: 'opacity 0.4s',
          transform: {
            xs: 'translateX(calc(100% * (var(--SideNavigation-slideIn, 0) - 1) + var(--SideNavigation-slideIn, 0) * var(--CoreLayoutSidebar-width, 0px)))',
            lg: 'translateX(-100%)',
          },
        }}
        onClick={() => {
          closeSidebar();
        }}
      />
      <Box
        className='ResourceSidebar'
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
          bgcolor: 'background.paper',
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
          dense
          sx={{
            overflowY: 'scroll',
            width: '100%',
            // Make the scrollbar invisible
            scrollbarWidth: 'none',
            msOverflowStyle: 'none',
            '&::-webkit-scrollbar': {
              display: 'none',
            },
            pt: 0,
            pb: 0,
          }}
        >
          {menuItems.map(item => {
            // Bogus to get it to work eventually
            const parentLink = `${location.pathname}/${item.name}`;

            return (
              <NavWrapper item={item} key={item.name} location={location.pathname}>
                <ListItem
                  secondaryAction={
                    Boolean(item.children?.length) && <IconButton
                      size='small'
                      edge='end'
                    >
                      <KeyboardArrowDown
                        sx={{ transform: 'initial' }}
                      />
                    </IconButton>
                  }
                  disablePadding
                >
                  <ListItemButton selected={location.pathname === parentLink}>
                    <ListItemIcon sx={{ minWidth: '1.5rem' }}>
                      {item.icon}
                    </ListItemIcon>
                    <ListItemText
                      primary={item.label}
                      primaryTypographyProps={{ variant: 'body2', fontWeight: 500 }}
                    />
                  </ListItemButton>
                </ListItem>
                {item.children.map(child => (
                  <Link to={`${parentLink}/${child.name}`} key={child.name} style={{ textDecoration: 'none' }} >
                    <ListItem disablePadding>
                      <ListItemButton selected={location.pathname === `${parentLink}/${child.name}`} sx={{ pl: 4 }}>
                        <ListItemText
                          primary={child.label}
                          primaryTypographyProps={{ variant: 'body2' }}
                        />
                      </ListItemButton>
                    </ListItem>
                  </Link>
                ))}
              </NavWrapper>
            );
          },
          )}
        </List>
      </Box>
    </>
  );
};

const NavWrapper = ({ item, children, location }: { item: any; children: any; location: string }) => {
  if (item?.children?.length) {
    return children;
  }

  return <Link to={`${location}/${item.name}`} key={item.name} style={{ textDecoration: 'none' }}>{children}</Link>;
};

export default ResourceSidebar;
