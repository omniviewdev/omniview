import React from 'react';

import Box from '@mui/joy/Box';
import Sheet from '@mui/joy/Sheet';
import List from '@mui/joy/List';
import ListItem from '@mui/joy/ListItem';
import ListItemContent from '@mui/joy/ListItemContent';
import ListItemDecorator from '@mui/joy/ListItemDecorator';
import ListItemButton from '@mui/joy/ListItemButton';
import MenuItem from '@mui/joy/MenuItem';
// Import Card from '@mui/joy/Card';
// import CardContent from '@mui/joy/CardContent';
// import AspectRatio from '@mui/joy/AspectRatio';
// import CardOverflow from '@mui/joy/CardOverflow';
import Typography from '@mui/joy/Typography';

// Icons
import {
  LuNetwork, LuServer, LuContainer, LuDatabase, LuCloudLightning, LuGroup, LuLayoutDashboard, LuCpu, LuFileJson2, LuShield,
} from 'react-icons/lu';

import { closeSidebar } from '../../utils';
import { Link, usePluginRouter } from '@infraview/router';
import { GlobalStyles, IconButton, Menu } from '@mui/joy';
import { KeyboardArrowDown } from '@mui/icons-material';
import usePanes from '@/hooks/usePanes';
import NavMenuButton from './ClusterResourceSidebarNested';

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

export default function ClusterResourceSidebar() {
  const { location } = usePluginRouter();
  const { numPanes } = usePanes();
  const [menuIndex, setMenuIndex] = React.useState<string | undefined>(undefined);
  const itemProps = {
    onClick() {
      setMenuIndex(undefined);
    },
  };

  const createHandleLeaveMenu
    = (menu: string) => (getIsOnButton: () => boolean) => {
    	setTimeout(() => {
    		const isOnButton = getIsOnButton();
    		if (!isOnButton) {
    			setMenuIndex((latestMenu: undefined | string) => {
    				if (menu === latestMenu) {
              return undefined;
    				}

    				return latestMenu;
    			});
    		}
    	}, 200);
    };

  return (
    <>
      <Box
        className='SecondSidebar-overlay'
        sx={{
          position: 'fixed',
          zIndex: 9998,
          bottom: 0,
          left: 0,
          width: '100vw',
          height: 'calc(100dvh - var(--GlobalTabBar-height))',
          opacity: 'var(--SideNavigation-slideIn)',
          backgroundColor: 'var(--joy-palette-background-backdrop)',
          transition: 'opacity 0.4s',
          transform: {
            xs: 'translateX(calc(100% * (var(--SideNavigation-slideIn, 0) - 1) + var(--SideNavigation-slideIn, 0) * var(--FirstSidebar-width, 0px)))',
            lg: 'translateX(-100%)',
          },
        }}
        onClick={() => {
          closeSidebar();
        }}
      />
      <Sheet
        className='ClusterResourceSidebar'
        color='neutral'
        sx={{
          position: {
            xs: 'fixed',
          },
          transform: {
            xs: 'translateX(calc(100% * (var(--SideNavigation-slideIn, 0) - 1) + var(--SideNavigation-slideIn, 0) * var(--FirstSidebar-width, 0px)))',
            lg: 'none',
          },
          transition: 'transform 0.4s',
          zIndex: 9999,
          height: 'calc(100dvh - var(--CoreLayoutHeader-height))',
          maxWidth: 'var(--ClusterResourceSidebar-width)',
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
            'root': {
              '--ClusterResourceSidebar-width': numPanes > 1 ? '53px' : '211px',
            },
          }}
        />
        {/* <Card variant="outlined" orientation="horizontal" sx={{ maxWidth: 280 }}> */}
        {/*   <CardOverflow sx={{ display: 'flex', alignItems: 'center', pt: 2, pb: 2, pl: 1 }}> */}
        {/*     <AspectRatio ratio="1" sx={{ width: 40, borderRadius: 4 }}> */}
        {/*       <img */}
        {/*         src="https://static-00.iconduck.com/assets.00/kubernetes-icon-2048x1995-r1q3f8n7.png" */}
        {/*         srcSet="https://static-00.iconduck.com/assets.00/kubernetes-icon-2048x1995-r1q3f8n7.png 2x" */}
        {/*         loading="lazy" */}
        {/*         alt="" */}
        {/*       /> */}
        {/*     </AspectRatio> */}
        {/*   </CardOverflow> */}
        {/*   <CardContent> */}
        {/*     <Typography level="title-md">{clusterId && truncateString(atob(clusterId), 38)}</Typography> */}
        {/*   </CardContent> */}
        {/* </Card> */}
        <List
          size='sm'
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
            '--ListItem-radius': '6px',
            '--ListItemDecorator-size': '1.5rem',
            // '--List-gap': '6px',
          }}
        >
          {menuItems.map(item => {
            return numPanes > 1
              ? <NavHoverButtonMenu item={item} location={location} itemProps={itemProps} menuFocused={menuIndex} setMenuFocused={setMenuIndex} createHandleLeaveMenu={createHandleLeaveMenu} />
              : <NavNormalMenu item={item} location={location} />;
          },
          )}
        </List>
      </Sheet>
    </>
  );
}

type Props = {
  item: any;
  itemProps: any;
  menuFocused: string | undefined;
  setMenuFocused: (menuFocused: string | undefined) => void;
  createHandleLeaveMenu: (menu: string) => (getIsOnButton: () => boolean) => void;
  location: string;
};

const NavHoverButtonMenu: React.FC<Props> = ({ item, itemProps, menuFocused, setMenuFocused, createHandleLeaveMenu, location }) => (
  <NavWrapper item={item} key={item.name}>
    <NavMenuButton
      label={item.label}
      aria-selected={location === `/explorer/${item.name}`}
      selected={location.startsWith(`/explorer/${item.name}`)}
      open={menuFocused === item.name}
      onOpen={() => {
        setMenuFocused(item.name);
      }}
      onLeaveMenu={createHandleLeaveMenu(item.name)}
      menu={item.children?.length
        ? <Menu onClose={() => {
          setMenuFocused(undefined);
        }}>
          {item.children.map((child: any) => (

            <Link to={`/explorer/${item.name}/${child.name}`} key={child.name} style={{ textDecoration: 'none' }} withinContext={true}>
              <MenuItem {...itemProps}>{child.label}</MenuItem>
            </Link>
          ))}
        </Menu> : <></>
      }
    >
      {item.icon}
    </NavMenuButton>
  </NavWrapper>
);

const NavNormalMenu: React.FC<{ item: any; location: string }> = ({ item, location }) => (
  <NavWrapper item={item} key={item.name}>
    <ListItem
      nested={Boolean(item.children?.length)}
      endAction={
        Boolean(item.children?.length) && <IconButton
          variant='plain'
          size='sm'
          color='neutral'
        >
          <KeyboardArrowDown
            sx={{ transform: 'initial' }}
          />
        </IconButton>
      }
    >
      <ListItemButton selected={location === `/explorer/${item.name}`}>
        <ListItemDecorator>
          {item.icon}
        </ListItemDecorator>
        <ListItemContent>
          <Typography level='title-sm' fontWeight={500}>{item.label}</Typography>
        </ListItemContent>
      </ListItemButton>
    </ListItem>
    {item.children.map((child: any) => (
      <Link to={`/explorer/${item.name}/${child.name}`} key={child.name} style={{ textDecoration: 'none' }} withinContext={true}>
        <ListItem nested>
          <ListItemButton selected={location === `/explorer/${item.name}/${child.name}`}>
            <ListItemDecorator sx={{ marginLeft: 1 }} />
            <ListItemContent>
              <Typography level='title-sm'>{child.label}</Typography>
            </ListItemContent>
          </ListItemButton>
        </ListItem>
      </Link>
    ))}
  </NavWrapper>
);

const NavWrapper = ({ item, children }: { item: any; children: any }) => {
  if (item?.children?.length) {
    return children;
  }

  return <Link to={`/explorer/${item.name}`} key={item.name} style={{ textDecoration: 'none' }} withinContext={true}>{children}</Link>;
};
