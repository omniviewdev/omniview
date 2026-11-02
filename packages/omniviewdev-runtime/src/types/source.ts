export type SourceSessionState = 'opening' | 'snapshotting' | 'following' | 'finished' | 'resetRequired' | 'failed' | 'closed';
export type SourceMode = 'snapshot' | 'snapshotAndUpdates';
export type SourceContinuity = 'notApplicable' | 'gapFree' | 'bestEffort';
export interface SourceCoverage {
  enumeration: 'exhausted' | 'partial' | 'unknown';
  consistency: 'pointInTime' | 'bestEffort' | 'unknown';
  limitations: string[];
}
