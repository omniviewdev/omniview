import type { AppError, AppErrorAction } from './types';
import { ErrorTypes } from './types';
import { navigateActivePage } from '../context/windows/activePageNavigator';

/** Canonical resource classifications mirror backend/pkg/apperror/resource.go. */
const resourceCodes: Record<string, readonly [string, number, AppError['recovery']]> = {
  INVALID_REQUEST: [ErrorTypes.VALIDATION, 400, 'correctRequest'],
  UNSUPPORTED: [ErrorTypes.NOT_IMPLEMENTED, 501, 'refreshContract'],
  FORBIDDEN: [ErrorTypes.RESOURCE_FORBIDDEN, 403, 'none'],
  UNAUTHORIZED: [ErrorTypes.RESOURCE_UNAUTHORIZED, 401, 'none'],
  NOT_FOUND: [ErrorTypes.RESOURCE_NOT_FOUND, 404, 'none'],
  CONFLICT: [ErrorTypes.RESOURCE_CONFLICT, 409, 'refreshContract'],
  ALREADY_EXISTS: [ErrorTypes.RESOURCE_CONFLICT, 409, 'refreshContract'],
  CANCELLED: [ErrorTypes.CANCELLED, 499, 'none'],
  TIMEOUT: [ErrorTypes.RESOURCE_TIMEOUT, 408, 'none'],
  UNAVAILABLE: [ErrorTypes.CONNECTION_FAILED, 503, 'reconnect'],
  CONNECTION_ERROR: [ErrorTypes.CONNECTION_FAILED, 503, 'reconnect'],
  CERTIFICATE_ERROR: [ErrorTypes.CONNECTION_FAILED, 502, 'reconnect'],
  RESOURCE_LIMIT: [ErrorTypes.RESOURCE_LIMIT, 429, 'correctRequest'],
  CONTINUATION_EXPIRED: [ErrorTypes.RESOURCE_CONTINUATION_EXPIRED, 410, 'restartQuery'],
  RESET_REQUIRED: [ErrorTypes.RESOURCE_RESET_REQUIRED, 409, 'restartQuery'],
  PARTIAL_RESULT: [ErrorTypes.RESOURCE_PARTIAL, 422, 'none'],
  PROVIDER_ERROR: [ErrorTypes.RESOURCE_PROVIDER_ERROR, 502, 'none'],
  INTERNAL: [ErrorTypes.INTERNAL, 500, 'none'],
};

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : undefined;
}
function text(value: unknown, limit: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= limit;
}
function cancellation(): AppError {
  return { type: ErrorTypes.CANCELLED, code: 'CANCELLED', title: 'Cancelled', status: 499, detail: 'The operation was cancelled.', recovery: 'none' };
}
function decode(error: unknown, depth: number): AppError | undefined {
  if (depth > 4) return undefined;
  if (error === 'cancelled') return cancellation();
  if (typeof error === 'string') {
    const raw = error.trim();
    if (!raw.startsWith('{')) return undefined;
    try { return decode(JSON.parse(raw), depth + 1); } catch { return undefined; }
  }
  const parsed = record(error);
  if (!parsed) return undefined;
  if (parsed.name === 'AbortError' || parsed.name === 'CancelError') return cancellation();
  // Only a complete host envelope is accepted. Provider-controlled fields are
  // sanitized authoritatively in Go; the SDK fallback below fails safely too.
  if (text(parsed.type, 256) && text(parsed.title, 256) && typeof parsed.status === 'number' && Number.isInteger(parsed.status) && parsed.status >= 100 && parsed.status <= 599 && typeof parsed.detail === 'string' && parsed.detail.length <= 4096) {
    const result: AppError = { type: parsed.type, title: parsed.title, status: parsed.status, detail: parsed.detail };
    if (text(parsed.code, 64)) result.code = parsed.code;
    if (text(parsed.requestId, 256)) result.requestId = parsed.requestId;
    if (text(parsed.instance, 512)) result.instance = parsed.instance;
    if (Array.isArray(parsed.suggestions)) result.suggestions = parsed.suggestions.filter((item): item is string => text(item, 512)).slice(0, 8);
    if (Array.isArray(parsed.actions)) result.actions = parsed.actions.filter((item): item is AppErrorAction => {
      const action = record(item);
      return !!action && ['navigate', 'retry', 'open-url', 'copy'].includes(String(action.type)) && text(action.label, 256) && (action.target === undefined || text(action.target, 4096));
    }).slice(0, 8);
    if (['correctRequest', 'refreshContract', 'restartQuery', 'reconnect', 'none'].includes(String(parsed.recovery))) result.recovery = parsed.recovery as AppError['recovery'];
    const location = record(parsed.location);
    if (location?.unit === 'utf8-byte' && typeof location.start === 'number' && typeof location.end === 'number' && Number.isSafeInteger(location.start) && Number.isSafeInteger(location.end) && location.start >= 0 && location.end >= location.start) {
      result.location = { start: location.start, end: location.end, unit: 'utf8-byte' };
    }
    return result;
  }
  if (typeof parsed.code === 'string' && typeof parsed.title === 'string' && typeof parsed.message === 'string') {
    let code = parsed.code;
    if (code === 'PERMISSION_DENIED') code = 'FORBIDDEN';
    if (['INVALID_INPUT', 'FILTER_UNKNOWN_FIELD', 'FILTER_INVALID_OPERATOR'].includes(code)) code = 'INVALID_REQUEST';
    if (!Object.prototype.hasOwnProperty.call(resourceCodes, code)) code = 'INTERNAL';
    if (code === 'CANCELLED') return cancellation();
    const [type, status, recovery] = resourceCodes[code]!;
    const safe = code === 'FORBIDDEN' || code === 'UNAUTHORIZED' || code === 'INTERNAL' || code === 'PROVIDER_ERROR';
    return {
      type, status, code, recovery,
      title: safe ? code === 'FORBIDDEN' ? 'Access denied' : code === 'UNAUTHORIZED' ? 'Authentication required' : 'Operation failed' : text(parsed.title, 256) ? parsed.title : 'Operation failed',
      detail: safe ? 'The operation could not be completed.' : text(parsed.message, 4096) ? parsed.message : 'The operation could not be completed.',
      ...(!safe && Array.isArray(parsed.suggestions) ? { suggestions: parsed.suggestions.filter((item): item is string => text(item, 512)).slice(0, 8) } : {}),
    };
  }
  return decode(parsed.message, depth + 1) ?? decode(parsed.cause, depth + 1);
}

/** Decode actual Wails/SDK errors without exposing arbitrary raw diagnostics. */
export function parseAppError(error: unknown): AppError {
  return decode(error, 0) ?? {
    type: ErrorTypes.INTERNAL,
    title: error == null ? 'Unknown error' : 'Error',
    status: 500,
    detail: error == null ? 'An unknown error occurred.' : 'The operation could not be completed.',
  };
}

export function isCancelledError(error: unknown): boolean {
  return parseAppError(error).type === ErrorTypes.CANCELLED;
}


/**
 * Converts an AppErrorAction into a { label, onClick } suitable for snackbar actions.
 */
export function actionToSnackbar(action: AppErrorAction): { label: string; onClick: () => void } {
  switch (action.type) {
    case 'navigate':
      return {
        label: action.label,
        // Settings targets activate their dedicated window; other routes use the active page.
        onClick: () => { navigateActivePage((action.target ?? '/').replace(/^#/, '')); },
      };
    case 'open-url':
      return {
        label: action.label,
        onClick: () => { window.open(action.target, '_blank'); },
      };
    case 'copy':
      return {
        label: action.label,
        onClick: () => { void navigator.clipboard.writeText(action.target ?? ''); },
      };
    case 'retry':
      // Retry is a no-op at this level — the caller should provide the retry fn.
      // We return a stub so the button renders.
      return {
        label: action.label,
        onClick: () => {},
      };
    default:
      return {
        label: action.label,
        onClick: () => {},
      };
  }
}

type ShowSnackbarFn = (options: {
  message: string;
  status: 'error' | 'warning' | 'info' | 'success' | 'default';
  details?: string;
  actions?: Array<{ label: string; onClick: () => void }>;
}) => void;

/**
 * Build the structured snackbar fields from a parsed AppError.
 * Use this when you need access to mutation variables in the message
 * but still want the full detail/suggestions/actions in the snackbar.
 *
 * @param appErr - The parsed AppError
 * @param contextMessage - Optional context to prepend to the title (e.g. "Failed to create pod-1")
 */
function buildSnackbarFields(appErr: AppError, contextMessage?: string) {
  const detail = [
    appErr.detail,
    ...(appErr.suggestions?.map(s => `• ${s}`) ?? []),
  ].join('\n');

  const message = contextMessage
    ? contextMessage
    : appErr.title !== 'Error' ? appErr.title : 'Operation failed';

  return {
    message,
    status: 'error' as const,
    details: detail,
    actions: appErr.actions?.map(actionToSnackbar),
  };
}

/**
 * Show a structured error snackbar from any Wails error.
 * Parses the error, suppresses cancellations, and displays
 * the full title/detail/suggestions/actions in the snackbar.
 *
 * @param showSnackbar - The snackbar function
 * @param error - The raw error from Wails
 * @param contextMessage - Optional context (e.g. "Failed to delete pod-1")
 */
export function showAppError(
  showSnackbar: ShowSnackbarFn,
  error: unknown,
  contextMessage?: string,
): void {
  if (isCancelledError(error)) return;
  const appErr = parseAppError(error);
  showSnackbar(buildSnackbarFields(appErr, contextMessage));
}

/**
 * Creates a drop-in onError handler that:
 * - Suppresses cancelled errors
 * - Parses structured AppError fields
 * - Shows a snackbar with title, detail, suggestions, and actions
 */
export function createErrorHandler(
  showSnackbar: ShowSnackbarFn,
  fallbackTitle: string,
): (error: unknown) => void {
  return (error: unknown) => {
    if (isCancelledError(error)) return;

    const appErr = parseAppError(error);
    showSnackbar(buildSnackbarFields(appErr, appErr.title !== 'Error' ? appErr.title : fallbackTitle));
  };
}
