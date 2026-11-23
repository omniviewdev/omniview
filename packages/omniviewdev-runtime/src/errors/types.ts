/** A frontend-renderable action attached to a structured error. */
export interface AppErrorAction {
  type: 'navigate' | 'retry' | 'open-url' | 'copy';
  label: string;
  target?: string;
}

/** Where a shell that a terminal tried came from. A token this runtime does not know is 'other'. */
export type AppErrorShellSource = 'requested' | 'environment' | 'account' | 'fallback' | 'other';

/** Why a shell that a terminal tried did not start. A token this runtime does not know is 'other'. */
export type AppErrorShellReason = 'not-found' | 'not-executable' | 'not-a-shell' | 'other';

/** A shell the host tried to start for a terminal and why it did not (code SHELL_UNAVAILABLE), as tokens that the caller maps to words: where its path came from, the path, the reason, and for 'other' the system's own words. */
export interface AppErrorShellAttempt {
  source: AppErrorShellSource;
  path: string;
  reason: AppErrorShellReason;
  detail?: string;
}

/** Structured error matching the Go apperror.AppError JSON shape. */
export interface AppError {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance?: string;
  suggestions?: string[];
  actions?: AppErrorAction[];
  code?: string;
  requestId?: string;
  recovery?: 'correctRequest' | 'refreshContract' | 'restartQuery' | 'reconnect' | 'none';
  location?: { start: number; end: number; unit: 'utf8-byte' };
  /** The shells a terminal tried before it refused, in the order tried (code SHELL_UNAVAILABLE): one path to a line, no sentence to read. */
  tried?: AppErrorShellAttempt[];
}

/** Error type URI constants matching Go apperror/types.go. */
export const ErrorTypes = {
  // Plugin
  PLUGIN_NOT_FOUND: 'omniview:plugin/not-found',
  PLUGIN_NOT_LOADED: 'omniview:plugin/not-loaded',
  PLUGIN_ALREADY_LOADED: 'omniview:plugin/already-loaded',
  PLUGIN_INSTALL_FAILED: 'omniview:plugin/install-failed',
  PLUGIN_LOAD_FAILED: 'omniview:plugin/load-failed',
  PLUGIN_BUILD_FAILED: 'omniview:plugin/build-failed',
  PLUGIN_COMMITTED_CLEANUP_PENDING: 'omniview:plugin/committed-cleanup-pending',
  PLUGIN_COMMIT_UNCERTAIN: 'omniview:plugin/commit-uncertain',

  // Settings
  SETTINGS_MISSING_CONFIG: 'omniview:settings/missing-config',
  SETTINGS_INVALID_CONFIG: 'omniview:settings/invalid-config',

  // Resource
  RESOURCE_NOT_FOUND: 'omniview:resource/not-found',
  RESOURCE_FORBIDDEN: 'omniview:resource/forbidden',
  RESOURCE_UNAUTHORIZED: 'omniview:resource/unauthorized',
  RESOURCE_CONFLICT: 'omniview:resource/conflict',
  RESOURCE_TIMEOUT: 'omniview:resource/timeout',
  RESOURCE_LIMIT: 'omniview:resource/limit',
  RESOURCE_CONTINUATION_EXPIRED: 'omniview:resource/continuation-expired',
  RESOURCE_RESET_REQUIRED: 'omniview:resource/reset-required',
  RESOURCE_PARTIAL: 'omniview:resource/partial',
  RESOURCE_PROVIDER_ERROR: 'omniview:resource/provider-error',

  // Connection
  CONNECTION_NOT_FOUND: 'omniview:connection/not-found',
  CONNECTION_FAILED: 'omniview:connection/failed',

  // Session
  SESSION_NOT_FOUND: 'omniview:session/not-found',
  SESSION_FAILED: 'omniview:session/failed',

  // General
  CANCELLED: 'omniview:cancelled',
  INTERNAL: 'omniview:internal',
  VALIDATION: 'omniview:validation',
  NOT_IMPLEMENTED: 'omniview:not-implemented',
} as const;
