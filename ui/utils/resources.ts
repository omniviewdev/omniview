
/**
* Gets all resources grouped by their GVR (Group, Version, Resource)
  */
export const getGroupedResourceNames = (): Record<string, string[]> =>
// For now, we're gonna just hardcode this
  ({
    'apps/v1': ['deployments', 'statefulsets', 'daemonsets', 'replicasets'],
    'autoscaling/v1': ['horizontalpodautoscalers'],
    'batch/v1': ['jobs', 'cronjobs'],
    'core/v1': ['pods', 'services', 'configmaps', 'secrets', 'namespaces', 'nodes', 'persistentvolumeclaims', 'persistentvolumes', 'serviceaccounts'],
    'coordination.k8s.io/v1': ['leases'],
    'discovery.k8s.io/v1': ['endpointslices'],
    'networking.k8s.io/v1': ['ingresses', 'ingressclasses', 'networkpolicies'],
    'rbac.authorization.k8s.io/v1': ['roles', 'rolebindings', 'clusterroles', 'clusterrolebindings'],
    'storage.k8s.io/v1': ['csidriver', 'csinode', 'storageclasses', 'volumeattachments'],
    // "apiextensions.k8s.io/v1": ["customresourcedefinitions"],
    // "cert-manager.io/v1": ["issuers", "clusterissuers", "certificates"],
    // "monitoring.coreos.com/v1": ["servicemonitors"],
    // "tekton.dev/v1beta1": ["pipelines", "pipelineruns", "tasks", "taskruns"],
  });

/**
 * Parses a resource key into its GVR (Group, Version, Resource) components
 *
 * @param resourceKey The key to parse
 * @returns The parsed GVR components
 * @throws If the resource key is invalid
 * @example
 * const key = "core::v1::pods"
 * const { group, version, resource } = parseResourceKey(key)
 */
export const parseResourceKey = (resourceKey: string): { group: string; version: string; resource: string } => {
  const [group, version, resource] = resourceKey.split('::');

  if (!group || !version || !resource) {
    throw new Error(`Invalid resourceID: ${resourceKey}`);
  }

  return { group, version, resource };
};
