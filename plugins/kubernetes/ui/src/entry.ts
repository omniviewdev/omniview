/// <reference types="@welldone-software/why-did-you-render" />
import React from 'react'
//@ts-ignore
window.PluginReact = React

/// <reference types="@welldone-software/why-did-you-render" />
import { PluginWindow, type DrawerContext } from '@omniviewdev/runtime';
import { RouteObject } from 'react-router-dom';

import ClustersPage from './pages/ClustersPage';
import ClusterEditPage from './pages/ClusterEditPage';
import ClusterResourcesPage from './pages/ClusterResourcesPage';
import ClusterDashboardPage from './pages/dashboard'

import DefaultTable from './components/kubernetes/table/default/Table';

// helm tables
import HelmReleaseTable from './components/helm/releases/Table';
import HelmRepoTable from './components/helm/repos/Table';

// admissionregistration.v1
import MutatingWebhookConfigurationTable from './components/kubernetes/table/admissionregistrationv1/MutatingWebhookConfiguration/Table'
import ValidatingAdmissionPolicyTable from './components/kubernetes/table/admissionregistrationv1/ValidatingAdmissionPolicy/Table'
import ValidatingAdmissionPolicyBindingTable from './components/kubernetes/table/admissionregistrationv1/ValidatingAdmissionPolicyBinding/Table'
import ValidatingWebhookConfigurationTable from './components/kubernetes/table/admissionregistrationv1/ValidatingWebhookConfiguration/Table'

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
import NamespaceTable from './components/kubernetes/table/corev1/Namespace/Table';
import NodeTable from './components/kubernetes/table/corev1/Node/Table';
import PersistentVolumeTable from './components/kubernetes/table/corev1/PersistentVolume/Table';
import PersistentVolumeClaimTable from './components/kubernetes/table/corev1/PersistentVolumeClaim/Table';
import PodTable from './components/kubernetes/table/corev1/Pod/Table';
import ReplicationControllerTable from './components/kubernetes/table/corev1/ReplicationController/Table';
import SecretTable from './components/kubernetes/table/corev1/Secret/Table';
import ServiceTable from './components/kubernetes/table/corev1/Service/Table';
import ServiceAccountTable from './components/kubernetes/table/corev1/ServiceAccount/Table';

// coordination.v1
import LeaseTable from './components/kubernetes/table/coordinationv1/Lease/Table';

// flowcontrol.v1
import PriorityLevelConfigurationTable from './components/kubernetes/table/flowcontrolv1/PriorityLevelConfiguration/Table';
import FlowSchemaTable from './components/kubernetes/table/flowcontrolv1/FlowSchema/Table';

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
import LimitRangeTable from './components/kubernetes/table/corev1/LimitRange/Table';
import ResourceQuotaTable from './components/kubernetes/table/corev1/ResourceQuota/Table';
import RuntimeClassTable from './components/kubernetes/table/nodev1/RuntimeClass/Table';
import EndpointSliceTable from './components/kubernetes/table/discoveryv1/EndpointSlice/Table';
import IngressClassTable from './components/kubernetes/table/networkingv1/IngressClass/Table';
import ClusterDashboardOverviewPage from './pages/dashboard/overview';
import ClusterDashboardBenchmarksPage from './pages/dashboard/benchmarks';

// ── Sidebar components ──────────────────────────────────────────────

// core.v1
import PodSidebar from './components/kubernetes/sidebar/Pod';
import NodeSidebar from './components/kubernetes/sidebar/NodeSidebar';
import SecretSidebar from './components/kubernetes/sidebar/SecretSidebar';
import ConfigMapSidebar from './components/kubernetes/table/corev1/ConfigMap/Sidebar';
import NamespaceSidebar from './components/kubernetes/table/corev1/Namespace/Sidebar';
import ServiceSidebar from './components/kubernetes/table/corev1/Service/Sidebar';
import ServiceAccountSidebar from './components/kubernetes/table/corev1/ServiceAccount/Sidebar';
import EndpointsSidebar from './components/kubernetes/table/corev1/Endpoints/Sidebar';
import ReplicationControllerSidebar from './components/kubernetes/table/corev1/ReplicationController/Sidebar';
import PersistentVolumeSidebar from './components/kubernetes/table/corev1/PersistentVolume/Sidebar';
import PersistentVolumeClaimSidebar from './components/kubernetes/table/corev1/PersistentVolumeClaim/Sidebar';
import LimitRangeSidebar from './components/kubernetes/table/corev1/LimitRange/Sidebar';
import ResourceQuotaSidebar from './components/kubernetes/table/corev1/ResourceQuota/Sidebar';

// apps.v1
import ReplicaSetSidebar from './components/kubernetes/table/appsv1/ReplicaSet/Sidebar';
import DaemonSetSidebar from './components/kubernetes/table/appsv1/DaemonSet/Sidebar';
import DeploymentSidebar from './components/kubernetes/table/appsv1/Deployment/Sidebar';
import StatefulSetSidebar from './components/kubernetes/table/appsv1/StatefulSet/Sidebar';

// batch.v1
import JobSidebar from './components/kubernetes/table/batchv1/Job/Sidebar';
import CronJobSidebar from './components/kubernetes/table/batchv1/CronJob/Sidebar';

// autoscaling.v1
import HorizontalPodAutoscalerSidebar from './components/kubernetes/table/autoscalingv1/HorizontalPodAutoscaler/Sidebar';

// policy.v1
import PodDisruptionBudgetSidebar from './components/kubernetes/table/policyv1/PodDisruptionBudget/Sidebar';

// flowcontrol.v1
import FlowSchemaSidebar from './components/kubernetes/table/flowcontrolv1/FlowSchema/Sidebar';

// rbac.v1
import ClusterRoleSidebar from './components/kubernetes/table/rbacv1/ClusterRole/Sidebar';
import ClusterRoleBindingSidebar from './components/kubernetes/table/rbacv1/ClusterRoleBinding/Sidebar';
import RoleSidebar from './components/kubernetes/table/rbacv1/Role/Sidebar';
import RoleBindingSidebar from './components/kubernetes/table/rbacv1/RoleBinding/Sidebar';

// networking.v1
import NetworkPolicySidebar from './components/kubernetes/table/networkingv1/NetworkPolicy/Sidebar';
import IngressClassSidebar from './components/kubernetes/table/networkingv1/IngressClass/Sidebar';

// discovery.v1
import EndpointSliceSidebar from './components/kubernetes/table/discoveryv1/EndpointSlice/Sidebar';

// node.v1
import RuntimeClassSidebar from './components/kubernetes/table/nodev1/RuntimeClass/Sidebar';

// storage.v1
import CSIDriverSidebar from './components/kubernetes/table/storagev1/CSIDriver/Sidebar';
import CSINodeSidebar from './components/kubernetes/table/storagev1/CSINode/Sidebar';
import StorageClassSidebar from './components/kubernetes/table/storagev1/StorageClass/Sidebar';
import VolumeAttachmentSidebar from './components/kubernetes/table/storagev1/VolumeAttachment/Sidebar';

// helm.v1
import ReleaseSidebar from './components/helm/releases/ReleaseSidebar';
import RepoSidebar from './components/helm/repos/RepoSidebar';

// admissionregistration.v1
import MutatingWebhookConfigurationSidebar from './components/kubernetes/table/admissionregistrationv1/MutatingWebhookConfiguration/Sidebar';
import ValidatingAdmissionPolicySidebar from './components/kubernetes/table/admissionregistrationv1/ValidatingAdmissionPolicy/Sidebar';
import ValidatingAdmissionPolicyBindingSidebar from './components/kubernetes/table/admissionregistrationv1/ValidatingAdmissionPolicyBinding/Sidebar';
import ValidatingWebhookConfigurationSidebar from './components/kubernetes/table/admissionregistrationv1/ValidatingWebhookConfiguration/Sidebar';

/**
 * Sidebar components keyed by resource key (group::version::Kind).
 * Registered with the host's sidebar registry at plugin load time so that
 * linked-resource chip clicks render the same rich sidebar as table row clicks.
 */
export const sidebars: Record<string, React.FC<{ ctx: DrawerContext }>> = {
  // core.v1
  'core::v1::Pod': PodSidebar,
  'core::v1::Node': NodeSidebar,
  'core::v1::Secret': SecretSidebar,
  'core::v1::ConfigMap': ConfigMapSidebar,
  'core::v1::Namespace': NamespaceSidebar,
  'core::v1::Service': ServiceSidebar,
  'core::v1::ServiceAccount': ServiceAccountSidebar,
  'core::v1::Endpoints': EndpointsSidebar,
  'core::v1::ReplicationController': ReplicationControllerSidebar,
  'core::v1::PersistentVolume': PersistentVolumeSidebar,
  'core::v1::PersistentVolumeClaim': PersistentVolumeClaimSidebar,
  'core::v1::LimitRange': LimitRangeSidebar,
  'core::v1::ResourceQuota': ResourceQuotaSidebar,
  // apps.v1
  'apps::v1::ReplicaSet': ReplicaSetSidebar,
  'apps::v1::DaemonSet': DaemonSetSidebar,
  'apps::v1::Deployment': DeploymentSidebar,
  'apps::v1::StatefulSet': StatefulSetSidebar,
  // batch.v1
  'batch::v1::Job': JobSidebar,
  'batch::v1::CronJob': CronJobSidebar,
  // autoscaling.v1
  'autoscaling::v1::HorizontalPodAutoscaler': HorizontalPodAutoscalerSidebar,
  // policy.v1
  'policy::v1::PodDisruptionBudget': PodDisruptionBudgetSidebar,
  // flowcontrol.v1
  'flowcontrol::v1::FlowSchema': FlowSchemaSidebar,
  // rbac.v1
  'rbac::v1::ClusterRole': ClusterRoleSidebar,
  'rbac::v1::ClusterRoleBinding': ClusterRoleBindingSidebar,
  'rbac::v1::Role': RoleSidebar,
  'rbac::v1::RoleBinding': RoleBindingSidebar,
  // networking.v1
  'networking::v1::NetworkPolicy': NetworkPolicySidebar,
  'networking::v1::IngressClass': IngressClassSidebar,
  // discovery.v1
  'discovery::v1::EndpointSlice': EndpointSliceSidebar,
  // node.v1
  'node::v1::RuntimeClass': RuntimeClassSidebar,
  // storage.v1
  'storage::v1::CSIDriver': CSIDriverSidebar,
  'storage::v1::CSINode': CSINodeSidebar,
  'storage::v1::StorageClass': StorageClassSidebar,
  'storage::v1::VolumeAttachment': VolumeAttachmentSidebar,
  // admissionregistration.v1
  'admissionregistration::v1::MutatingWebhookConfiguration': MutatingWebhookConfigurationSidebar,
  'admissionregistration::v1::ValidatingAdmissionPolicy': ValidatingAdmissionPolicySidebar,
  'admissionregistration::v1::ValidatingAdmissionPolicyBinding': ValidatingAdmissionPolicyBindingSidebar,
  'admissionregistration::v1::ValidatingWebhookConfiguration': ValidatingWebhookConfigurationSidebar,
  // helm.v1
  'helm::v1::Release': ReleaseSidebar,
  'helm::v1::Repository': RepoSidebar,
};

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
            path: '',
            Component: ClusterDashboardPage,
            children: [
              { path: '', index: true, Component: ClusterDashboardOverviewPage },
              { path: 'benchmarks', Component: ClusterDashboardBenchmarksPage },
            ]
          },
          // admissionregistration.v1
          { path: 'admissionregistration_v1_MutatingWebhookConfiguration', Component: MutatingWebhookConfigurationTable },
          { path: 'admissionregistration_v1_ValidatingAdmissionPolicy', Component: ValidatingAdmissionPolicyTable },
          { path: 'admissionregistration_v1_ValidatingAdmissionPolicyBinding', Component: ValidatingAdmissionPolicyBindingTable },
          { path: 'admissionregistration_v1_ValidatingWebhookConfiguration', Component: ValidatingWebhookConfigurationTable },

          // apps.v1
          { path: 'apps_v1_DaemonSet', Component: DaemonSetTable },
          { path: 'apps_v1_Deployment', Component: DeploymentTable },
          { path: 'apps_v1_ReplicaSet', Component: ReplicaSetTable },
          { path: 'apps_v1_StatefulSet', Component: StatefulSetTable },

          // autoscaling.v1
          { path: 'autoscaling_v1_HorizontalPodAutoscaler', Component: HorizontalPodAutoscalerTable },

          // autoscaling.v2
          { path: 'autoscaling_v2_HorizontalPodAutoscaler', Component: HorizontalPodAutoscalerTable },

          // batch.v1
          { path: 'batch_v1_CronJob', Component: CronJobTable },
          { path: 'batch_v1_Job', Component: JobTable },

          // core.v1
          { path: 'core_v1_ComponentStatus', Component: ComponentStatusTable },
          { path: 'core_v1_ConfigMap', Component: ConfigMapTable },
          { path: 'core_v1_Endpoints', Component: EndpointsTable },
          { path: 'core_v1_Event', Component: EventTable },
          { path: 'core_v1_LimitRange', Component: LimitRangeTable },
          { path: 'core_v1_Namespace', Component: NamespaceTable },
          { path: 'core_v1_Node', Component: NodeTable },
          { path: 'core_v1_PersistentVolume', Component: PersistentVolumeTable },
          { path: 'core_v1_PersistentVolumeClaim', Component: PersistentVolumeClaimTable },
          { path: 'core_v1_Pod', Component: PodTable },
          { path: 'core_v1_ResourceQuota', Component: ResourceQuotaTable },
          { path: 'core_v1_Secret', Component: SecretTable },
          { path: 'core_v1_Service', Component: ServiceTable },
          { path: 'core_v1_ServiceAccount', Component: ServiceAccountTable },
          { path: 'core_v1_ReplicationController', Component: ReplicationControllerTable },

          // coordination.v1
          { path: 'coordination_v1_Lease', Component: LeaseTable },

          // discovery.v1
          { path: 'discovery_v1_EndpointSlice', Component: EndpointSliceTable },

          // flowcontrol.v1
          { path: 'flowcontrol_v1_PriorityLevelConfiguration', Component: PriorityLevelConfigurationTable },
          { path: 'flowcontrol_v1_FlowSchema', Component: FlowSchemaTable },

          // networking.v1
          { path: 'networking_v1_Ingress', Component: IngressTable },
          { path: 'networking_v1_IngressClass', Component: IngressClassTable },
          { path: 'networking_v1_NetworkPolicy', Component: NetworkPolicyTable },

          // node.v1
          { path: 'node_v1_RuntimeClass', Component: RuntimeClassTable },

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

          // helm.v1
          { path: 'helm_v1_Release', Component: HelmReleaseTable },
          { path: 'helm_v1_Repository', Component: HelmRepoTable },

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
