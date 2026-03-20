/**
 * Re-export Wails-generated enums from Go source of truth.
 * These are generated from plugin-sdk/pkg/v1/resource via Wails v3 bindings.
 */
import { WatchState } from '../bindings/github.com/omniviewdev/plugin-sdk/pkg/v1/resource/models';

export { WatchState };

/**
 * WatchStateEvent is emitted when a resource's watch state changes.
 * Matches Go type: plugin-sdk/pkg/v1/resource.WatchStateEvent
 */
export interface WatchStateEvent {
  pluginId: string;
  connection: string;
  resourceKey: string;
  state: WatchState;
  resourceCount: number;
  message?: string;
  errorCode?: string;
}

/**
 * WatchConnectionSummary provides an aggregate view of all watch states for a connection.
 */
export interface WatchConnectionSummary {
  connection: string;
  resources: Record<string, WatchState>;
  resourceCounts: Record<string, number>;
  totalResources: number;
  syncedCount: number;
  errorCount: number;
}
