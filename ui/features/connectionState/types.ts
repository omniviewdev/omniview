import type { Count, WatchState } from '@omniviewdev/runtime';

/** Identifies the target connection for the state dialog */
export type ConnectionStateTarget = {
  pluginID: string;
  connectionID: string;
  connectionName: string;
};

/** Describes a single resource's watch state for display */
export type ResourceStateItem = {
  key: string;
  kind: string;
  state: WatchState;
  count?: Count;
};

/** Grouped resources: [groupLabel, items] */
export type ResourceStateGroup = [groupLabel: string, items: ResourceStateItem[]];
