import { Outlet } from 'react-router-dom';

import CoreLayout from './layouts/core/main/CoreLayout';
import ClusterLayout from './layouts/ClusterLayout';

// lazy load each container
import Clusters from './pages/Clusters';

// Connecting page
import Connecting from './pages/connecting';
import Settings from "./pages/settings";

// In cluster routes
import Pods from './pages/cluster/pods';
import Nodes from './pages/cluster/nodes';
import Namespaces from './pages/cluster/namespaces';

import Deployments from './pages/cluster/compute/deployments';
import StatefulSets from './pages/cluster/compute/statefulsets';
import DaemonSets from './pages/cluster/compute/daemonsets';
import ReplicaSets from './pages/cluster/compute/replicasets';
import Jobs from './pages/cluster/compute/jobs';
import CronJobs from './pages/cluster/compute/cronjobs';

import Services from './pages/cluster/network/services';
import Ingresses from './pages/cluster/network/ingresses';
import IngressClasses from './pages/cluster/network/ingressclasses';
import Endpoints from './pages/cluster/network/endpoints';
import NetworkPolicies from './pages/cluster/network/networkpolicies';

import PersistentVolumes from "./pages/cluster/storage/persistentvolumes";
import PersistentVolumeClaims from "./pages/cluster/storage/persistentvolumeclaims";
import StorageClasses from "./pages/cluster/storage/storageclasses";
import VolumeAttachments from "./pages/cluster/storage/volumeattachments";

import ConfigMaps from "./pages/cluster/configuration/configmaps";
import Secrets from "./pages/cluster/configuration/secrets";

import Roles from "./pages/cluster/security/roles";
import RoleBindings from "./pages/cluster/security/rolebindings";
import ClusterRoles from "./pages/cluster/security/clusterroles";
import ClusterRoleBindings from "./pages/cluster/security/clusterrolebindings";
import ServiceAccounts from "./pages/cluster/security/serviceaccounts";
import PaneRenderer from './providers/PaneProvider';
import { RouterErrorBoundary } from './ErrorBoundary';
import Container from './layouts/core/main/Container';
import Welcome from './pages/welcome';

/**
 * Route segments for the Kubernetes plugin.
 * TODO - this will be moved into the plugin itself
 * once the plugin system is in place.
 */
export const KubernetesPluginRoutes = [
  {
    path: '',
    Component: Clusters,
  },
  {
    // Contextual routes. These are routes that are
    // nested within a specific context, such as a cluster.
    path: ':contextID',
    children: [
      {
        path: "connecting",
        Component: Connecting,
      },
      {
        path: "explorer",
        Component: ClusterLayout,
        children: [
          {
            path: "nodes",
            Component: Nodes,
          },
          {
            path: "pods",
            Component: Pods,
          },
          {
            path: "namespaces",
            Component: Namespaces,
          },
          {
            path: "compute",
            Component: Outlet,
            children: [
              {
                path: "deployments",
                Component: Deployments,
              },
              {
                path: "statefulsets",
                Component: StatefulSets,
              },
              {
                path: "daemonsets",
                Component: DaemonSets,
              },
              {
                path: "replicasets",
                Component: ReplicaSets,
              },
              {
                path: "jobs",
                Component: Jobs,
              },
              {
                path: "cronjobs",
                Component: CronJobs,
              },
            ],
          },
          {
            path: "network",
            Component: Outlet,
            children: [
              {
                path: "services",
                Component: Services,
              },
              {
                path: "ingresses",
                Component: Ingresses,
              },
              {
                path: "ingressclasses",
                Component: IngressClasses,
              },
              {
                path: "endpoints",
                Component: Endpoints,
              },
              {
                path: "networkpolicies",
                Component: NetworkPolicies,
              },
            ],
          },
          {
            path: "storage",
            Component: Outlet,
            children: [
              {
                path: 'persistentvolumes',
                Component: PersistentVolumes,
              },
              {
                path: 'persistentvolumeclaims',
                Component: PersistentVolumeClaims,
              },
              {
                path: 'storageclasses',
                Component: StorageClasses,
              },
              {
                path: 'volumeattachments',
                Component: VolumeAttachments,
              },
            ]
          },
          {
            path: "configuration",
            Component: Outlet,
            children: [
              {
                path: 'configmaps',
                Component: ConfigMaps,
              },
              {
                path: 'secrets',
                Component: Secrets,
              },
            ]
          },
          {
            path: "security",
            Component: Outlet,
            children: [
              {
                path: 'roles',
                Component: Roles,
              },
              {
                path: 'rolebindings',
                Component: RoleBindings,
              },
              {
                path: 'clusterroles',
                Component: ClusterRoles,
              },
              {
                path: 'clusterrolebindings',
                Component: ClusterRoleBindings,
              },
              {
                path: 'serviceaccounts',
                Component: ServiceAccounts,
              },
            ]
          }
        ],
      },
    ],
  },
]



export const scoped = [
  {
    path: "/",
    Component: Container,
    ErrorBoundary: RouterErrorBoundary,
    children: [
      {
        path: "",
        index: true,
        Component: Welcome,
      },
      {
        path: "kubernetes",
        children: KubernetesPluginRoutes,
      },
      // Add more plugins here. TODO - make this dynamic. Hardcoded for P.O.C
    ]
  }
]


/**
 *
 * The core router exists at the root of the application, and is used to provide
 * the global layout and navigation to the rest of the application.
 * Routes withing this router will override any display within the pane renderer,
 * with the root route displaying the pane renderer.
 */
export const core = [
  {
    path: "/",
    Component: CoreLayout,
    children: [
      {
        path: "/",
        index: true,
        Component: PaneRenderer,
      },
      {
        path: "settings",
        Component: Settings,
      },
    ],
  },
];
