import { ObjectMeta } from "kubernetes-types/meta/v1";

/**
 * Props passed in by the IDE to the resource sidebar component.
 */
export interface ResourceSidebarProps {
  /** The JSON data of the resource passed in */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data?: any;
  ///** Handler to submit an update to the resource backend */
  //onSubmit: (data: Record<string, unknown>) => void;
  ///** Handler to cancel the update */
  //onCancel: () => void;
  ///** Search handler to find other resources */
  //useSearch: (options: ResourceSearch) => ResourceSearchResult[];
}

export interface ResourceSearch {
  /** The resources to search through. Limited to resources within the same plugin and connection */
  searches: ResourceSearchEntry[];
}

export interface ResourceSearchResult {
  key: string;
  namespaces: string[];
  isLoading: boolean;
  isError: boolean;
  // eslint-disable-next-line @typescript-eslint/ban-types
  error: Error | null;
  data: unknown[];
}

export type UseResourceSearchOptions = {
  /**
   * The ID of the plugin responsible for this resource
   * @example "kubernetes"
   */
  pluginID: string;

  /**
   * The connection ID to scope the resource to
   * @example "integration"
   */
  connectionID: string;

  /**
   * Entry for the resource search
   */
  searches: ResourceSearchEntry[];
};

export type ResourceSearchEntry = {
  /**
   * The key of the resource
   */
  key: string;

  /**
   * The namespaces to search for the resource
   */
  namespaces: string[];

  /**
   * Post-retrieve function filter to apply after the resources are found
   */
  postFilter?: (resource: Record<string, unknown>) => boolean;
};

/**
 * Defines the interface that every kubernetes resource object must adhere to
 */
export interface KubernetesResourceObject {
  apiVersion?: string
  kind?: string
  metadata?: ObjectMeta
}
