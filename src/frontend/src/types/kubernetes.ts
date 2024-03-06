import { ObjectMeta } from "kubernetes-types/meta/v1";

/**
 * This table is specifically designed for handling Kubernetes resources. As such, we want
 * to ensure that the table is able to index on the metadata
 */
export interface KubernetesResource {
  apiVersion?: string;
  kind?: string;
  metadata?: ObjectMeta;
}

/**
 * ContextedResource represent a resource scoped to a specific context
 */
export interface ContextedResource {
  context: string;
  resource: KubernetesResource;
}
