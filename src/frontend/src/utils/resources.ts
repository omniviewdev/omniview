
/**
* Gets all resources grouped by their GVR (Group, Version, Resource)
  */
export const getGroupedResourceNames = (): { [key: string]: string[] } => {
  // for now, we're gonna just hardcode this
  return {
    "apps/v1": ["deployments", "statefulsets", "daemonsets", "replicasets"],
    "autoscaling/v1": ["horizontalpodautoscalers"],
    "batch/v1": ["jobs", "cronjobs"],
    "core/v1": ["pods", "services", "configmaps", "secrets", "namespaces", "nodes", "persistentvolumeclaims", "persistentvolumes", "serviceaccounts"],
    "coordination.k8s.io/v1": ["leases"],
    "discovery.k8s.io/v1": ["endpointslices"],
    "networking.k8s.io/v1": ["ingresses", "ingressclasses", "networkpolicies"],
    "rbac.authorization.k8s.io/v1": ["roles", "rolebindings", "clusterroles", "clusterrolebindings"],
    "storage.k8s.io/v1": ["csidriver", "csinode", "storageclasses", "volumeattachments"],
    // "apiextensions.k8s.io/v1": ["customresourcedefinitions"],
    // "cert-manager.io/v1": ["issuers", "clusterissuers", "certificates"],
    // "monitoring.coreos.com/v1": ["servicemonitors"],
    // "tekton.dev/v1beta1": ["pipelines", "pipelineruns", "tasks", "taskruns"],
  }
}
