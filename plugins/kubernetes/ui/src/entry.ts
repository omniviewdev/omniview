/// <reference types="@welldone-software/why-did-you-render" />
import React from 'react'
//@ts-ignore
window.PluginReact = React

/// <reference types="@welldone-software/why-did-you-render" />
import { PluginWindow } from '@omniviewdev/runtime';
import { Outlet, RouteObject } from 'react-router-dom';

import ClustersPage from './pages/ClustersPage';
import ClusterEditPage from './pages/ClusterEditPage';
import ClusterResourcesPage from './pages/ClusterResourcesPage';

import DefaultTable from './components/kubernetes/table/default/Table';

// apps.v1
import DaemonSetTable from './components/kubernetes/table/appsv1/DaemonSet/Table';
import DeploymentTable from './components/kubernetes/table/appsv1/Deployment/Table';
import ReplicaSetTable from './components/kubernetes/table/appsv1/ReplicaSet/Table';
import StatefulSetTable from './components/kubernetes/table/appsv1/StatefulSet/Table';

// autoscaling.v1
import HorizontalPodAutoscalerTable from './components/kubernetes/table/autoscalingv1/HorizontalPodAutoscaler/Table';

// batch.v1
import CronJobTable from './components/kubernetes/table/batchv1/CronJob/Table';
import JobTable from './components/kubernetes/table/batchv1/Job/Table';

// core.v1
import ComponentStatusTable from './components/kubernetes/table/corev1/ComponentStatus/Table';
import ConfigMapTable from './components/kubernetes/table/corev1/ConfigMap/Table';
import EndpointsTable from './components/kubernetes/table/corev1/Endpoints/Table';
import EventTable from './components/kubernetes/table/corev1/Event/Table';
import NodeTable from './components/kubernetes/table/corev1/Node/Table';
import PersistentVolumeTable from './components/kubernetes/table/corev1/PersistentVolume/Table';
import PersistentVolumeClaimTable from './components/kubernetes/table/corev1/PersistentVolumeClaim/Table';
import PodTable from './components/kubernetes/table/corev1/Pod/Table';
import ReplicationControllerTable from './components/kubernetes/table/corev1/ReplicationController/Table';
import SecretTable from './components/kubernetes/table/corev1/Secret/Table';
import ServiceTable from './components/kubernetes/table/corev1/Service/Table';
import ServiceAccountTable from './components/kubernetes/table/corev1/ServiceAccount/Table';

// networking.v1
import IngressTable from './components/kubernetes/table/networkingv1/Ingress/Table';
import NetworkPolicyTable from './components/kubernetes/table/networkingv1/NetworkPolicy/Table';

// policy.v1
import PodDisruptionBudgetTable from './components/kubernetes/table/policyv1/PodDisruptionBudget/Table';

// rbac.v1
import ClusterRoleTable from './components/kubernetes/table/rbacv1/ClusterRole/Table';
import ClusterRoleBindingTable from './components/kubernetes/table/rbacv1/ClusterRoleBinding/Table';
import RoleTable from './components/kubernetes/table/rbacv1/Role/Table';
import RoleBindingTable from './components/kubernetes/table/rbacv1/RoleBinding/Table';

// scheduling.v1
import PriorityClassTable from './components/kubernetes/table/schedulingv1/PriorityClass/Table';

// storage.v1
import CSIDriverTable from './components/kubernetes/table/storagev1/CSIDriver/Table';
import CSINodeTable from './components/kubernetes/table/storagev1/CSINode/Table';
import CSIStorageCapacityTable from './components/kubernetes/table/storagev1/CSIStorageCapacity/Table';
import StorageClassTable from './components/kubernetes/table/storagev1/StorageClass/Table';
import VolumeAttachmentTable from './components/kubernetes/table/storagev1/VolumeAttachment/Table';

const routes: Array<RouteObject> = [
  {
    path: '/',
    Component: ClustersPage,
  },
  {
    path: '/clusters',
    Component: ClustersPage,
  },
  {
    path: '/cluster/:id',
    children: [
      {
        path: 'edit',
        Component: ClusterEditPage,
      },
      {
        path: 'resources',
        Component: ClusterResourcesPage,
        children: [
          {
            index: true,
            Component: Outlet
          },

          // apps.v1
          { path: 'apps_v1_DaemonSet', Component: DaemonSetTable },
          { path: 'apps_v1_Deployment', Component: DeploymentTable },
          { path: 'apps_v1_ReplicaSet', Component: ReplicaSetTable },
          { path: 'apps_v1_StatefulSet', Component: StatefulSetTable },

          // autoscaling.v1
          { path: 'autoscaling_v1_HorizontalPodAutoscaler', Component: HorizontalPodAutoscalerTable },

          // batch.v1
          { path: 'batch_v1_CronJob', Component: CronJobTable },
          { path: 'batch_v1_Job', Component: JobTable },

          // core.v1
          { path: 'core_v1_ComponentStatus', Component: ComponentStatusTable },
          { path: 'core_v1_ConfigMap', Component: ConfigMapTable },
          { path: 'core_v1_Endpoints', Component: EndpointsTable },
          { path: 'core_v1_Event', Component: EventTable },
          { path: 'core_v1_Node', Component: NodeTable },
          { path: 'core_v1_PersistentVolume', Component: PersistentVolumeTable },
          { path: 'core_v1_PersistentVolumeClaim', Component: PersistentVolumeClaimTable },
          { path: 'core_v1_Pod', Component: PodTable },
          { path: 'core_v1_Secret', Component: SecretTable },
          { path: 'core_v1_Service', Component: ServiceTable },
          { path: 'core_v1_ServiceAccount', Component: ServiceAccountTable },
          { path: 'core_v1_ReplicationController', Component: ReplicationControllerTable },

          // networking.v1
          { path: 'networking_v1_Ingress', Component: IngressTable },
          { path: 'networking_v1_NetworkPolicy', Component: NetworkPolicyTable },

          // policy.v1
          { path: 'policy_v1_PodDisruptionBudget', Component: PodDisruptionBudgetTable },

          // rbac.v1
          { path: 'rbac_v1_ClusterRole', Component: ClusterRoleTable },
          { path: 'rbac_v1_ClusterRoleBinding', Component: ClusterRoleBindingTable },
          { path: 'rbac_v1_Role', Component: RoleTable },
          { path: 'rbac_v1_RoleBinding', Component: RoleBindingTable },

          // scheduling.v1
          { path: 'scheduling_v1_PriorityClass', Component: PriorityClassTable },

          // storage.v1
          { path: 'storage_v1_CSIDriver', Component: CSIDriverTable },
          { path: 'storage_v1_CSINode', Component: CSINodeTable },
          { path: 'storage_v1_CSIStorageCapacity', Component: CSIStorageCapacityTable },
          { path: 'storage_v1_StorageClass', Component: StorageClassTable },
          { path: 'storage_v1_VolumeAttachment', Component: VolumeAttachmentTable },

          // Custom Resource Definitions / breaking api versions
          { path: ':resourceKey', Component: DefaultTable }
        ]
      }
    ]
  }
]

export const plugin = new PluginWindow()
  .setRootPage(ClustersPage)
  .withRoutes(routes)
