import { useCallback, useEffect, useMemo, useState } from 'react';
import { produce } from 'immer';

// types
import { EventsOff, EventsOn } from '@runtime/runtime';
import { resources } from '@api/models';
import { KubernetesResource } from '@/types/kubernetes';


// core/v1
import { Pod, Namespace, Node, Secret, Service, ConfigMap, PersistentVolume, PersistentVolumeClaim, Endpoints, ServiceAccount } from 'kubernetes-types/core/v1';
import { List as ListPods } from '@api/resources/PodService';
import { List as ListNamespaces } from '@api/resources/NamespaceService';
import { List as ListNodes } from '@api/resources/NodeService';
import { List as ListSecrets } from '@api/resources/SecretService';
import { List as ListServices } from '@api/resources/ServiceService';
import { List as ListConfigMaps } from '@api/resources/ConfigMapService';
import { List as ListPersistentVolumes } from '@api/resources/PersistentVolumeService';
import { List as ListPersistentVolumeClaims } from '@api/resources/PersistentVolumeClaimService';
import { List as ListEndpoints } from '@api/resources/EndpointsService';
import { List as ListServiceAccounts } from '@api/resources/ServiceAccountService';

// apps/v1
import { Deployment, ReplicaSet, StatefulSet, DaemonSet } from 'kubernetes-types/apps/v1';
import { List as ListDeployments } from '@api/appsv1/DeploymentService';
import { List as ListReplicaSets } from '@api/appsv1/ReplicaSetService';
import { List as ListStatefulSets } from '@api/appsv1/StatefulSetService';
import { List as ListDaemonSets } from '@api/appsv1/DaemonSetService';

// batch/v1
import { Job, CronJob } from 'kubernetes-types/batch/v1';
import { List as ListJobs } from '@api/batchv1/JobService';
import { List as ListCronJobs } from '@api/batchv1/CronJobService';

// networking.k8s.io/v1
import { Ingress, IngressClass, NetworkPolicy } from 'kubernetes-types/networking/v1';
import { List as ListIngresses } from '@api/networkingv1/IngressService';
import { List as ListIngressClasses } from '@api/networkingv1/IngressClassService';
import { List as ListNetworkPolicies } from '@api/networkingv1/NetworkPolicyService';

// rbac.authorization.k8s.io/v1
import { Role, RoleBinding, ClusterRole, ClusterRoleBinding } from 'kubernetes-types/rbac/v1';
import { List as ListRoles } from '@api/rbacv1/RoleService';
import { List as ListRoleBindings } from '@api/rbacv1/RoleBindingService';
import { List as ListClusterRoles } from '@api/rbacv1/ClusterRoleService';
import { List as ListClusterRoleBindings } from '@api/rbacv1/ClusterRoleBindingService';

// storage.k8s.io/v1
import { StorageClass, VolumeAttachment } from 'kubernetes-types/storage/v1';
import { List as ListStorageClasses } from '@api/storagev1/StorageClassService';
import { List as ListVolumeAttachments } from '@api/storagev1/VolumeAttachmentService';

// Options for ordering when fetching pods
export type OrderOptions = {
  // The field to order by
  field: string;
  // The direction to order by
  direction: 'asc' | 'desc';
}

export type Options = {
  // The clusters contexts to search in. for most cases, this will be a single cluster id, but for multi-cluster
  // support, this could be multiple cluster ids
  clusters?: string[] | string;
  // A name to filter pods by
  name?: string;
  // The namespaces to list pods in
  namespaces?: string[];
  // Labels to filter pods by
  labels?: Record<string, string>;
  // Order options
  order?: OrderOptions;
}

export type UseKubernetesResult<T extends KubernetesResource> = {
  /** The resources that were fetched */
  resources: T[];
  /** Whether the resources are currently loading */
  loading: boolean;
  /** The error if one occurred */
  error: Error | null;
}

export type UpdateEvent<T extends KubernetesResource> = {
  oldObj: T;
  newObj: T;
}

export type UseKubernetesParams = {
  lister: (arg1: resources.ListOptions) => Promise<any>;
  type: string;
  options?: Options;
}

/**
  * useKubernetes will fetch and subscribe to viewing and listing resources given a set of search parameters,
  * returning a loading state, error state and the resources data.
  */
const useKubernetes = <T extends KubernetesResource>({ lister, type, options = {} }: UseKubernetesParams): UseKubernetesResult<T> => {
  let {
    clusters,
    name = "",
    namespaces = useMemo(() => [], []),
    labels = useMemo(() => ({}), []),
  } = options;

  const [resources, setResources] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);


  /**
   * Handle adding new resources to the resource list
   */
  const onResourceAdd = useCallback((newResources: T[]) => {
    console.log("Adding resources", newResources)
    setResources(current => produce(current, (draft: T[]) => {
      draft.push(...newResources);
    }));
  }, []);

  /**
   * Handle updating pods in the pods list
   */
  const onResourceUpdate = useCallback((updateEvents: UpdateEvent<T>[]) => {
    console.log("Updating resources", updateEvents)
    setResources(current => produce(current, (draft: T[]) => {
      updateEvents.forEach(({ oldObj, newObj }) => {
        const index = draft.findIndex(p => p.metadata?.uid === oldObj.metadata?.uid);
        if (index !== -1) {
          draft[index] = newObj;
        }
      });
    }));
  }, []);

  /**
   * Handle deleting pods from the pods list
   */
  const onResourceDelete = useCallback((deletedResources: T[]) => {
    console.log("Deleting resources", deletedResources)
    setResources(current => produce(current, (draft: T[]) => {
      return draft.filter(p => !deletedResources.some(d => d.metadata?.uid === p.metadata?.uid));
    }));
  }, []);

  useEffect(() => {
    if (clusters === undefined) {

      // handle the case where clusters is undefined and we don't want to fetch anything
      // this is likely a bug in the code if this happens, but we'll handle it gracefully
      // and not fetch anything
      console.warn("No clusters were specified for fetching resources");
      return;
    } else if (typeof clusters === "string") {
      clusters = [clusters];
    }

    setLoading(true);
    setError(null);
    lister({ clusters, namespaces, name, labels })
      .then((resources: { [context: string]: T[] }) => {
        // for not, we'll just flatten until we know what we want to do here.
        setResources(Object.values(resources).flat())
        setLoading(false);
      })
      .catch((err) => {
        setError(err);
        setLoading(false);
      });
  }, [name, namespaces, labels]);

  // *Only on mount*, we want subscribe to new resources, updates and deletes
  // and update the pods list accordingly
  // 
  // TODO - eventually we want to have the ability for multiple subscribers for the same resource,
  // so that various pages can subscribe to filtered views of the same resource. for now this is fine
  // to get the core functionality working
  useEffect(() => {
    // - Add events: <context>::<resource>::ADD
    // - Update events: <context>::<resource>::UPDATE
    // - Delete events: <context>::<resource>::DELETE
    if (clusters === undefined) {
      return;
    }
    for (const cluster of clusters) {
      EventsOn(`${cluster}::${type}::ADD`, onResourceAdd);
      EventsOn(`${cluster}::${type}::UPDATE`, onResourceUpdate);
      EventsOn(`${cluster}::${type}::DELETE`, onResourceDelete);
    }

    return () => {
      if (clusters === undefined) {
        return;
      }
      for (const cluster of clusters) {
        EventsOff(`${cluster}::${type}::ADD`);
        EventsOff(`${cluster}::${type}::UPDATE`);
        EventsOff(`${cluster}::${type}::DELETE`);
      }
    }
  }, []);

  return { resources, loading, error };
}

// Export hooks for each resource type
// core/v1
export const usePods = (options?: Options): UseKubernetesResult<Pod> => useKubernetes({ lister: ListPods, type: "pods", options });
export const useNamespaces = (options?: Options): UseKubernetesResult<Namespace> => useKubernetes({ lister: ListNamespaces, type: "namespaces", options });
export const useNodes = (options?: Options): UseKubernetesResult<Node> => useKubernetes({ lister: ListNodes, type: "nodes", options });
export const useSecrets = (options?: Options): UseKubernetesResult<Secret> => useKubernetes({ lister: ListSecrets, type: "secrets", options });
export const useServices = (options?: Options): UseKubernetesResult<Service> => useKubernetes({ lister: ListServices, type: "services", options });
export const useConfigMaps = (options?: Options): UseKubernetesResult<ConfigMap> => useKubernetes({ lister: ListConfigMaps, type: "configmaps", options });
export const usePersistentVolumes = (options?: Options): UseKubernetesResult<PersistentVolume> => useKubernetes({ lister: ListPersistentVolumes, type: "persistentvolumes", options });
export const usePersistentVolumeClaims = (options?: Options): UseKubernetesResult<PersistentVolumeClaim> => useKubernetes({ lister: ListPersistentVolumeClaims, type: "persistentvolumeclaims", options });
export const useEndpoints = (options?: Options): UseKubernetesResult<Endpoints> => useKubernetes({ lister: ListEndpoints, type: "endpoints", options });
export const useServiceAccounts = (options?: Options): UseKubernetesResult<ServiceAccount> => useKubernetes({ lister: ListServiceAccounts, type: "serviceaccounts", options });

// apps/v1
export const useDeployments = (options?: Options): UseKubernetesResult<Deployment> => useKubernetes({ lister: ListDeployments, type: "deployments", options });
export const useReplicaSets = (options?: Options): UseKubernetesResult<ReplicaSet> => useKubernetes({ lister: ListReplicaSets, type: "replicasets", options });
export const useStatefulSets = (options?: Options): UseKubernetesResult<StatefulSet> => useKubernetes({ lister: ListStatefulSets, type: "statefulsets", options });
export const useDaemonSets = (options?: Options): UseKubernetesResult<DaemonSet> => useKubernetes({ lister: ListDaemonSets, type: "daemonsets", options });

// batch/v1
export const useJobs = (options?: Options): UseKubernetesResult<Job> => useKubernetes({ lister: ListJobs, type: "jobs", options });
export const useCronJobs = (options?: Options): UseKubernetesResult<CronJob> => useKubernetes({ lister: ListCronJobs, type: "cronjobs", options });

// networking.k8s.io/v1
export const useIngresses = (options?: Options): UseKubernetesResult<Ingress> => useKubernetes({ lister: ListIngresses, type: "ingresses", options });
export const useIngressClasses = (options?: Options): UseKubernetesResult<IngressClass> => useKubernetes({ lister: ListIngressClasses, type: "ingressclasses", options });
export const useNetworkPolicies = (options?: Options): UseKubernetesResult<NetworkPolicy> => useKubernetes({ lister: ListNetworkPolicies, type: "networkpolicies", options });

// rbac.authorization.k8s.io/v1
export const useRoles = (options?: Options): UseKubernetesResult<Role> => useKubernetes({ lister: ListRoles, type: "roles", options });
export const useRoleBindings = (options?: Options): UseKubernetesResult<RoleBinding> => useKubernetes({ lister: ListRoleBindings, type: "rolebindings", options });
export const useClusterRoles = (options?: Options): UseKubernetesResult<ClusterRole> => useKubernetes({ lister: ListClusterRoles, type: "clusterroles", options });
export const useClusterRoleBindings = (options?: Options): UseKubernetesResult<ClusterRoleBinding> => useKubernetes({ lister: ListClusterRoleBindings, type: "clusterrolebindings", options });

// storage.k8s.io/v1
export const useStorageClasses = (options?: Options): UseKubernetesResult<StorageClass> => useKubernetes({ lister: ListStorageClasses, type: "storageclasses", options });
export const useVolumeAttachments = (options?: Options): UseKubernetesResult<VolumeAttachment> => useKubernetes({ lister: ListVolumeAttachments, type: "volumeattachments", options });
