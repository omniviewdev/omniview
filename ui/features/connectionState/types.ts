import type { WatchState } from '@omniviewdev/runtime';

/** Identifies the target connection for the state dialog */
export interface ConnectionStateTarget {
  pluginID: string;
  connectionID: string;
  connectionName: string;
}

/** Describes a single resource's watch state for display */
export interface ResourceStateItem {
  key: string;
  kind: string;
  state: WatchState;
  count: number;
}

/** Grouped resources: [groupLabel, items] */
export type ResourceStateGroup = [groupLabel: string, items: ResourceStateItem[]];
