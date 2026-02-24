import { usePluginContext, useResourceGroups, useInformerState, InformerResourceState } from "@omniviewdev/runtime";
import type { NavSection, NavMenuItem } from "@omniviewdev/ui/sidebars";
import React from "react";
import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";
import { types } from "@omniviewdev/runtime/models";
import { LuBlocks, LuBoxes, LuClipboard, LuCloudLightning, LuDatabase, LuGauge, LuLayers2, LuLock, LuNetwork, LuServer, LuTicket } from "react-icons/lu";
import { SiHelm } from "react-icons/si";
import DynamicIcon from "../components/shared/Icon";
import { IsImage } from "../utils/url";
import { toResourceKey } from "../utils/resourceKey";

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
const labelSort = (a: NavMenuItem, b: NavMenuItem) => a.label.localeCompare(b.label)

/**
 * Resolve an icon value (string name, image URL, or ReactNode) to a ReactNode.
 */
function resolveIcon(icon: string | React.ReactNode | undefined, size = 16): React.ReactNode | undefined {
  if (!icon) return undefined;
  if (typeof icon !== 'string') return icon;
  if (icon === '') return undefined;
  if (IsImage(icon)) return <img src={icon} alt="" style={{ width: size, height: size, objectFit: 'contain' }} />;
  return <DynamicIcon name={icon} size={size} />;
}


// --- Informer state badges ---

const SyncingBadge = () => <CircularProgress size={10} thickness={5} sx={{ color: 'var(--ov-accent-fg, #58a6ff)' }} />;
const ErrorBadge = () => <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: 'error.main', flexShrink: 0 }} />;

/** Get a badge for a nav item based on its informer state */
const getStateBadge = (navId: string, states?: Record<string, InformerResourceState>): React.ReactNode | undefined => {
  if (!states) return undefined;
  const state = states[toResourceKey(navId)];
  if (state === InformerResourceState.Syncing || state === InformerResourceState.Pending) return <SyncingBadge />;
  if (state === InformerResourceState.Error) return <ErrorBadge />;
  return undefined;
};

/** Get a group-level badge by aggregating children states */
const getGroupBadge = (children: NavMenuItem[], states?: Record<string, InformerResourceState>): React.ReactNode | undefined => {
  if (!states || !children?.length) return undefined;
  let hasSyncing = false;
  let hasError = false;
  for (const child of children) {
    const state = states[toResourceKey(child.id)];
    if (state === InformerResourceState.Syncing || state === InformerResourceState.Pending) hasSyncing = true;
    if (state === InformerResourceState.Error) hasError = true;
  }
  if (hasError) return <ErrorBadge />;
  if (hasSyncing) return <SyncingBadge />;
  return undefined;
};

/**
 * Calculates the full sidebar layout divided by the API groups
 */
const calculateFullLayout = (data: Record<string, types.ResourceGroup>, informerStates?: Record<string, InformerResourceState>): Array<NavSection> => {
  if (!data) {
    return []
  }

  const coreSection: NavMenuItem[] = [];
  const crdSection: NavMenuItem[] = [];

  const grouped: NavMenuItem[] = Object.values(data).map((group) => {
    const children: NavMenuItem[] = [];

    Object.entries(group.resources).forEach(([_, metas]) => {
      metas.forEach((meta) => {
        children.push({
          id: toID(meta),
          label: meta.kind,
          icon: resolveIcon(meta.icon),
          badge: getStateBadge(toID(meta), informerStates),
        });
      });
    });

    children.sort((a, b) => a.label.localeCompare(b.label));

    const item: NavMenuItem = {
      id: group.id,
      label: group.name,
      icon: resolveIcon(group.icon),
      children,
      badge: getGroupBadge(children, informerStates),
    };

    return item;
  }).sort((a, b) => a.label.localeCompare(b.label));

  grouped.forEach((group) => {
    if (isCrd(group.label)) {
      crdSection.push(group);
    } else {
      coreSection.push(group);
    }
  });

  const sections: NavSection[] = [
    { title: '', items: [{ id: '__dashboard__', label: 'Dashboard', icon: <LuGauge /> }, ...coreSection] },
    { title: 'Custom Resource Definitions', items: crdSection },
  ];

  return sections;
}

type ModernSection = 'workload' | 'config' | 'network' | 'storage' | 'access_control' | 'admission_control' | 'helm'

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

  // Helm
  'Release': 'helm',
  'Repository': 'helm',
  'Chart': 'helm',
}


/**
 * Calculates a modern sidebar layout inspired by Kubernetes Dashboard for familiarity. Only adds
 * resources that are available.
 */
const calculateModernLayout = (data: Record<string, types.ResourceGroup>, informerStates?: Record<string, InformerResourceState>): Array<NavSection> => {
  if (!data) {
    return []
  }

  const withBadge = (id: string, label: string): NavMenuItem => ({
    id,
    label,
    badge: getStateBadge(id, informerStates),
  });

  // Grouped Resource areas
  const workloadResources: NavMenuItem[] = [];
  const configResources: NavMenuItem[] = [];
  const networkResources: NavMenuItem[] = [];
  const storageResources: NavMenuItem[] = [];
  const accessControlResources: NavMenuItem[] = [];
  const admissionControlResources: NavMenuItem[] = [];
  const helmResources: NavMenuItem[] = [];

  const crds: Record<string, Array<NavMenuItem>> = {}

  Object.values(data).forEach((group) => {
    Object.entries(group.resources).forEach(([_, metas]) => {
      metas.forEach((meta) => {
        const navItem = withBadge(toID(meta), meta.kind);
        // if CRD, push to CRD
        if (isCrd(meta.group)) {
          if (!crds[meta.group]) {
            crds[meta.group] = []
          }
          crds[meta.group].push(navItem)
        } else {
          switch (ModernSectionMap[meta.kind]) {
            case "workload":
              workloadResources.push(navItem)
              break
            case "config":
              configResources.push(navItem)
              break
            case "network":
              networkResources.push(navItem)
              break
            case "storage":
              storageResources.push(navItem)
              break
            case "access_control":
              accessControlResources.push(navItem)
              break
            case "admission_control":
              admissionControlResources.push(navItem)
              break
            case "helm":
              helmResources.push(navItem)
              break
          }
        }
      });
    });
  });

  const crdChildren: NavMenuItem[] = Object.entries(crds).map(([group, entry]) => ({
    id: group,
    label: group,
    children: entry.sort(labelSort),
    badge: getGroupBadge(entry, informerStates),
  }))

  const workloadSorted = workloadResources.sort(labelSort);
  const configSorted = configResources.sort(labelSort);
  const networkSorted = networkResources.sort(labelSort);
  const storageSorted = storageResources.sort(labelSort);
  const accessSorted = accessControlResources.sort(labelSort);
  const admissionSorted = admissionControlResources.sort(labelSort);
  const helmSorted = helmResources.sort(labelSort);
  const crdSorted = crdChildren.sort(labelSort);

  const sections: NavSection[] = [
    {
      title: '',
      items: [
        { id: '__dashboard__', label: 'Dashboard', icon: <LuGauge /> },
        { id: 'core_v1_Node', label: 'Nodes', icon: <LuServer />, badge: getStateBadge('core_v1_Node', informerStates) },
        { id: 'events_v1_Event', label: 'Events', icon: <LuCloudLightning />, badge: getStateBadge('events_v1_Event', informerStates) },
        { id: 'core_v1_Namespace', label: 'Namespaces', icon: <LuLayers2 />, badge: getStateBadge('core_v1_Namespace', informerStates) },
        { id: 'workload', label: 'Workload', icon: <LuBoxes />, children: workloadSorted, badge: getGroupBadge(workloadSorted, informerStates) },
        { id: 'config', label: 'Config', icon: <LuClipboard />, children: configSorted, badge: getGroupBadge(configSorted, informerStates) },
        { id: 'network', label: 'Networking', icon: <LuNetwork />, children: networkSorted, badge: getGroupBadge(networkSorted, informerStates) },
        { id: 'storage', label: 'Storage', icon: <LuDatabase />, children: storageSorted, badge: getGroupBadge(storageSorted, informerStates) },
        { id: 'access_control', label: 'Access Control', icon: <LuLock />, children: accessSorted, badge: getGroupBadge(accessSorted, informerStates) },
        { id: 'admission_control', label: 'Admission Control', icon: <LuTicket />, children: admissionSorted, badge: getGroupBadge(admissionSorted, informerStates) },
        { id: 'helm', label: 'Helm', icon: <SiHelm />, children: helmSorted, badge: getGroupBadge(helmSorted, informerStates) },
        { id: 'crd', label: 'Custom Resource Definitions', icon: <LuBlocks />, children: crdSorted, badge: getGroupBadge(crdSorted, informerStates) },
      ]
    },
  ];

  return sections;
}

/**
 * Provide one of number of sidebar layouts to the caller
 */
export const useSidebarLayout = ({ connectionID }: Opts) => {
  const { settings } = usePluginContext()
  const { groups } = useResourceGroups({ pluginID: 'kubernetes', connectionID });
  const { summary } = useInformerState({ pluginID: 'kubernetes', connectionID });

  const informerStates = summary.data?.resources;

  const [layout, setLayout] = React.useState<Array<NavSection>>([])
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
        setLayout(calculateModernLayout(groups.data, informerStates))
        break
      case "full":
        setLayout(calculateFullLayout(groups.data, informerStates))
        break
    }
    setIsLoading(false)
  }, [groups.data, settings['kubernetes.layout'], informerStates])

  return {
    layout,
    isLoading,
  }
}
