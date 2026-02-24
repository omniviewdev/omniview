/** A frontend-renderable action attached to a structured error. */
export interface AppErrorAction {
  type: 'navigate' | 'retry' | 'open-url' | 'copy';
  label: string;
  target?: string;
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

  // Settings
  SETTINGS_MISSING_CONFIG: 'omniview:settings/missing-config',
  SETTINGS_INVALID_CONFIG: 'omniview:settings/invalid-config',

  // Resource
  RESOURCE_NOT_FOUND: 'omniview:resource/not-found',
  RESOURCE_FORBIDDEN: 'omniview:resource/forbidden',
  RESOURCE_UNAUTHORIZED: 'omniview:resource/unauthorized',
  RESOURCE_CONFLICT: 'omniview:resource/conflict',
  RESOURCE_TIMEOUT: 'omniview:resource/timeout',

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
