import type { UseQueryResult } from '@tanstack/react-query';
import type { HostGetRequest, HostRecord } from '../resource/v2/host';
import { useResource as useResourceWithMutation } from '../hooks/resource/useResource';

export interface UseResourceOptions {
  /** The plugin whose records are read. Omitted, the plugin the page belongs to. */
  pluginID?: string;
  /** The object to read. Omitted, nothing is read. */
  request?: HostGetRequest;
  enabled?: boolean;
}

export interface UseResourceResult {
  /**
   * One read of one object, once its connection is ready. It is NOT live: nothing updates it when the object changes or is deleted
   * (a deleted object is a failed refetch, not a signal), so `refetch` it, or read a collection with `useResources` for updates.
   */
  resource: UseQueryResult<HostRecord, Error>;
}

/**
 * Read one object by its reference. The runtime's `useResource` also returns a `mutate` function (a write to the object); the curated surface is
 * read-only, so that is not passed on: a write belongs to a reviewed addition of its own, not to a side effect of this read.
 */
export const useResource = (input: UseResourceOptions): UseResourceResult => {
  const { resource } = useResourceWithMutation(input);
  return { resource };
};
