import { usePluginContext, useResourceGroups } from "@omniviewdev/runtime";
import { SidebarItem, SidebarSection } from "../components/shared/navmenu/types";
import React from "react";
import { types } from "@omniviewdev/runtime/models";
import { LuBlocks, LuBoxes, LuClipboard, LuCloudLightning, LuDatabase, LuLayers2, LuLock, LuNetwork, LuServer, LuTicket } from "react-icons/lu";

type Opts = {
  connectionID: string;
}

/**
 * Get the ID from the meta object
 */
const toID = (meta: types.ResourceMeta) => `${meta.group}_${meta.version}_${meta.kind}`;

/**
 * Returns whether the item is a CRD resource or not
 */
const isCrd = (group: string) => group.includes('.') && !group.includes('.k8s.io')

/** sorter for sorting alphabetically by labels */
const labelSort = (a: SidebarItem, b: SidebarItem) => a.label.localeCompare(b.label)


/** 
 * Calculates the full sidebar layout given all of the provided resource types available
 * to the client.
 */
const calculateFullLayout = (data: Record<string, types.ResourceGroup>): Array<SidebarSection> => {
  if (!data) {
    return []
  }

  const coreSection: SidebarItem[] = [];
  const crdSection: SidebarItem[] = [];

  const grouped: SidebarItem[] = Object.values(data).map((group) => {
    const item: SidebarItem = {
      id: group.id,
      label: group.name,
      icon: group.icon,
      children: [],
    };

    Object.entries(group.resources).forEach(([_, metas]) => {
      metas.forEach((meta) => {
        item.children?.push({
          id: toID(meta),
          label: meta.kind,
          icon: meta.icon,
        });
      });
    });

    // Sort the children
    item.children = item.children?.sort((a, b) => a.label.localeCompare(b.label));
    return item;
  }).sort((a, b) => a.label.localeCompare(b.label));

  grouped.forEach((group) => {
    // This is kubernetes specific, let's eventually allow plugins to define this somehow
    if (isCrd(group.label)) {
      // custom resource definition
      crdSection.push(group);
    } else {
      coreSection.push(group);
    }
  });

  const sections: SidebarSection[] = [
    { id: 'core', title: '', items: coreSection },
    { id: 'crd', title: 'Custom Resource Definitions', items: crdSection },
  ];

  return sections;
}

type ModernSection = 'workload' | 'config' | 'network' | 'storage' | 'access_control' | 'admission_control'

/**
 * Map of where found resources should go
 */
const ModernSectionMap: Record<string, ModernSection> = {
  // Workload
  'Pod': 'workload',
  'ReplicationController': 'workload',
  'Deployment': 'workload',
  'DaemonSet': 'workload',
  'ReplicaSet': 'workload',
  'StatefulSet': 'workload',
  'CronJob': 'workload',
  'Job': 'workload',

  // Config
  'ConfigMap': 'config',
  'Secret': 'config',
  'ResourceQuota': 'config',
  'LimitRange': 'config',
  'HorizontalPodAutoscaler': 'config',
  'PodDisruptionBudget': 'config',
  'PriorityClass': 'config',
  'RuntimeClass': 'config',
  'Lease': 'config',
  'FlowSchema': 'config',
  'PriorityLevelConfiguration': 'config',

  // Networking
  'Ingress': 'network',
  'IngressClass': 'network',
  'Endpoints': 'network',
  'EndpointSlice': 'network',
  'Service': 'network',
  'NetworkPolicy': 'network',

  // Storage
  'PersistentVolume': 'storage',
  'PersistentVolumeClaim': 'storage',
  'StorageClass': 'storage',
  'CSIDriver': 'storage',
  'CSINode': 'storage',
  'VolumeAttachment': 'storage',

  // Access Control
  'ServiceAccount': 'access_control',
  'Role': 'access_control',
  'ClusterRole': 'access_control',
  'RoleBinding': 'access_control',
  'ClusterRoleBinding': 'access_control',

  // Admission Control
  'MutatingWebhookConfiguration': 'admission_control',
  'ValidatingWebhookConfiguration': 'admission_control',
  'ValidatingAdmissionPolicy': 'admission_control',
  'ValidatingAdmissionPolicyBinding': 'admission_control',
}


/** 
 * Calculates a modern sidebar layout inspired by Kubernetes Dashboard for familiarity. Only adds
 * resources that are available.
 */
const calculateModernLayout = (data: Record<string, types.ResourceGroup>): Array<SidebarSection> => {
  if (!data) {
    return []
  }

  // Grouped Resource areas
  const workloadResources: SidebarItem[] = [];
  const configResources: SidebarItem[] = [];
  const networkResources: SidebarItem[] = [];
  const storageResources: SidebarItem[] = [];
  const accessControlResources: SidebarItem[] = [];
  const admissionControlResources: SidebarItem[] = [];

  const crds: Record<string, Array<SidebarItem>> = {}

  Object.values(data).forEach((group) => {
    Object.entries(group.resources).forEach(([_, metas]) => {
      metas.forEach((meta) => {
        // if CRD, push to CRD
        if (isCrd(meta.group)) {
          if (!crds[meta.group]) {
            crds[meta.group] = []
          }

          crds[meta.group].push({
            id: toID(meta),
            label: meta.kind,
            icon: '',
          })
        } else {
          switch (ModernSectionMap[meta.kind]) {
            case "workload":
              workloadResources.push({
                id: toID(meta),
                label: meta.kind,
                icon: ''
              })
              break
            case "config":
              configResources.push({
                id: toID(meta),
                label: meta.kind,
                icon: ''
              })
              break
            case "network":
              networkResources.push({
                id: toID(meta),
                label: meta.kind,
                icon: ''
              })
              break
            case "storage":
              storageResources.push({
                id: toID(meta),
                label: meta.kind,
                icon: ''
              })
              break
            case "access_control":
              accessControlResources.push({
                id: toID(meta),
                label: meta.kind,
                icon: ''
              })
              break
            case "admission_control":
              admissionControlResources.push({
                id: toID(meta),
                label: meta.kind,
                icon: ''
              })
              break
          }
        }
      });
    });
  });

  const crdChildren: SidebarItem[] = Object.entries(crds).map(([group, entry]) => ({
    id: group,
    label: group,
    icon: '',
    children: entry.sort(labelSort)
  }))

  const sections: SidebarSection[] = [
    {
      id: 'native',
      title: '',
      items: [
        { id: 'core_v1_Node', label: 'Nodes', icon: <LuServer /> },
        { id: 'events_v1_Event', label: 'Events', icon: <LuCloudLightning /> },
        { id: 'core_v1_Namespace', label: 'Namespaces', icon: <LuLayers2 /> },
        { id: 'workload', label: 'Workload', icon: <LuBoxes />, defaultExpanded: true, children: workloadResources.sort(labelSort) },
        { id: 'config', label: 'Config', icon: <LuClipboard />, defaultExpanded: true, children: configResources.sort(labelSort) },
        { id: 'network', label: 'Networking', icon: <LuNetwork />, defaultExpanded: true, children: networkResources.sort(labelSort) },
        { id: 'storage', label: 'Storage', icon: <LuDatabase />, defaultExpanded: true, children: storageResources.sort(labelSort) },
        { id: 'access_control', label: 'Access Control', icon: <LuLock />, defaultExpanded: true, children: accessControlResources.sort(labelSort) },
        { id: 'admission_control', label: 'Admission Control', icon: <LuTicket />, defaultExpanded: true, children: admissionControlResources.sort(labelSort) },
        { id: 'crd', label: 'Custom Resource Definitions', icon: <LuBlocks />, defaultExpanded: true, children: crdChildren.sort(labelSort) },
      ]
    },
  ];

  return sections;
}

/**
 * Provde one of number of sidebar layouts to the caller
 */
export const useSidebarLayout = ({ connectionID }: Opts) => {
  const { settings } = usePluginContext()
  const { groups } = useResourceGroups({ pluginID: 'kubernetes', connectionID });

  const [layout, setLayout] = React.useState<Array<SidebarSection>>([])
  const [isLoading, setIsLoading] = React.useState<boolean>(true)

  /**
   * Renders the full layout divided by the API groups
   */
  React.useEffect(() => {
    if (!groups.data) {
      return
    }

    setIsLoading(true)

    switch (settings['kubernetes.layout']) {
      case "modern":
        setLayout(calculateModernLayout(groups.data))
        break
      case "full":
        setLayout(calculateFullLayout(groups.data))
        break
    }
    setIsLoading(false)
  }, [groups.data, settings['kubernetes.layout']])

  return {
    layout,
    isLoading,
  }
}
