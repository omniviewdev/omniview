import { type types } from '@omniviewdev/runtime/models';

export type ProviderConfig = {
  label: string;
  color: string;
};

export const providerConfig: Record<string, ProviderConfig> = {
  eks: { label: 'Amazon EKS', color: '#FF9900' },
  gke: { label: 'Google GKE', color: '#4285F4' },
  aks: { label: 'Azure AKS', color: '#0078D4' },
  kind: { label: 'kind', color: '#326CE5' },
  minikube: { label: 'Minikube', color: '#F4B400' },
  'docker-desktop': { label: 'Docker Desktop', color: '#2496ED' },
  k3d: { label: 'k3d', color: '#FFC61C' },
  k3s: { label: 'k3s', color: '#FFC61C' },
  openshift: { label: 'OpenShift', color: '#EE0000' },
  rancher: { label: 'Rancher', color: '#0075A8' },
  generic: { label: 'Kubernetes', color: '#326CE5' },
};

/**
 * Detects the Kubernetes provider from a connection's labels and data.
 */
export function detectProvider(conn: types.Connection): string {
  const cluster = (conn.labels?.cluster as string) ?? (conn.data?.cluster as string) ?? '';
  const user = (conn.labels?.user as string) ?? (conn.data?.user as string) ?? '';
  const name = conn.name ?? '';
  const allFields = `${cluster} ${user} ${name}`.toLowerCase();

  // EKS: ARN pattern or eks in cluster name
  if (cluster.includes('arn:aws:eks:') || allFields.includes('eks')) {
    return 'eks';
  }

  // GKE: gke_ prefix in cluster name
  if (cluster.startsWith('gke_') || allFields.includes('gke_')) {
    return 'gke';
  }

  // AKS: Azure-style cluster name
  if (allFields.includes('aks') || allFields.includes('azure') || allFields.includes('akspool')) {
    return 'aks';
  }

  // kind: kind- prefix
  if (name.startsWith('kind-') || cluster.startsWith('kind-')) {
    return 'kind';
  }

  // minikube
  if (name === 'minikube' || cluster === 'minikube') {
    return 'minikube';
  }

  // Docker Desktop
  if (name === 'docker-desktop' || cluster === 'docker-desktop') {
    return 'docker-desktop';
  }

  // k3d
  if (name.startsWith('k3d-') || cluster.startsWith('k3d-')) {
    return 'k3d';
  }

  // k3s
  if (allFields.includes('k3s')) {
    return 'k3s';
  }

  // OpenShift
  if (allFields.includes('openshift') || allFields.includes('ocp')) {
    return 'openshift';
  }

  // Rancher
  if (allFields.includes('rancher')) {
    return 'rancher';
  }

  return 'generic';
}

/**
 * Returns the human-readable provider label for a given provider key.
 */
export function getProviderLabel(provider: string): string {
  return providerConfig[provider]?.label ?? provider;
}

/**
 * Returns the color for a given provider key.
 */
export function getProviderColor(provider: string): string {
  return providerConfig[provider]?.color ?? '#326CE5';
}
