export type ConnectionMetadataValue = null | boolean | number | string | ConnectionMetadataValue[] | { [key: string]: ConnectionMetadataValue };
export interface ConnectionMetadataError { code: string; message: string }
export type ConnectionMetadataEntry =
  | { state: 'current'; value: ConnectionMetadataValue; observedAt: string }
  | { state: 'stale'; value: ConnectionMetadataValue; observedAt: string; error?: ConnectionMetadataError }
  | { state: 'unavailable'; error: ConnectionMetadataError };
export interface ConnectionMetadataSnapshot {
  connectionID: string;
  generation: string;
  revision: string;
  active: boolean;
  refreshing: boolean;
  lastRefreshError?: ConnectionMetadataError;
  entries: Record<string, ConnectionMetadataEntry>;
}
/** Host registration identity is opaque and never numerically ordered. */
export interface ConnectionMetadataEnvelope {
  pluginID: string;
  registrationID: string;
  supported: boolean;
  transportAvailable: boolean;
  snapshot?: ConnectionMetadataSnapshot;
  removed?: boolean;
  connectionID?: string;
  revision?: string;
}

/** Safe for decisions: stale, inactive, unavailable, and non-string facts are excluded. */
export function readCurrentConnectionMetadataString(snapshot: ConnectionMetadataSnapshot | undefined, transportAvailable: boolean, key: string): string | undefined {
  if (!transportAvailable || !snapshot?.active) return undefined;
  const entry = snapshot.entries[key];
  return entry?.state === 'current' && typeof entry.value === 'string' ? entry.value : undefined;
}
