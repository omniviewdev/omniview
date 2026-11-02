export type DiagnosticContribution = {
  id: string; pluginId: string; label: string;
  source: string; valueType: string; resourceKey?: string;
  status: 'registered' | 'quarantined'; crashCount: number;
};
export type DiagnosticPoint = {
  id: string; owner: string; mode: 'single' | 'multiple'; version: number;
  contributions: DiagnosticContribution[];
};
export type DiagnosticPending = {
  id: string; pluginId: string; pointId: string; source: string; status: 'pending-target';
};
export type DiagnosticProblem = {
  id: string;
  kind: 'pending-target' | 'quarantined' | 'render-error' | 'plugin-error' | 'dependency-warning';
  pluginId: string; pointId?: string; contributionId?: string;
  message: string; stack?: string; componentStack?: string;
  boundary?: string; timestamp?: number; crashCount?: number;
};
export type DiagnosticPlugin = { id: string; phase: string; error?: string; warnings: string[] };
export type ExtensionDiagnosticSnapshot = {
  schemaVersion: 1; capturedAt: string; windowName: string;
  points: DiagnosticPoint[]; pending: DiagnosticPending[];
  plugins: DiagnosticPlugin[]; problems: DiagnosticProblem[];
  coverage: string[];
  limits: { quarantineCrashThreshold: number; maxCrashRecordsPerContribution: number };
  truncated: boolean;
};
export type DiagnosticFilter = { pluginId?: string; pointId?: string; issuesOnly?: boolean; query?: string };
export type DiagnosticCaptureOptions = { windowName: string; includeSensitive?: boolean };
export type DiagnosticLookupRequest = { pointId: string; pluginId: string; resourceKey: string };
export type DiagnosticLookupResult = {
  schemaVersion: 1; capturedAt: string; windowName: string;
  pointId: string; pluginId: string; resourceKey: string; inventoryCount: number;
  selected: Array<{ id: string; pluginId: string; quarantined: boolean }>;
  coverage: string[];
};
