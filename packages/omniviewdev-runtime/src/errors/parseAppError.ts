import type { AppError, AppErrorAction } from './types';
import { ErrorTypes } from './types';

/**
 * Parse any error shape from the Wails boundary into a structured AppError.
 *
 * Handles:
 * - JSON string from AppError.Error() → parsed into typed AppError
 * - Plain string from old fmt.Errorf → wrapped as internal error
 * - Error object → extracts .message, tries JSON parse
 * - null/undefined → generic "Unknown error"
 *
 * NEVER returns null.
 */
export function parseAppError(error: unknown): AppError {
  if (error == null) {
    return {
      type: ErrorTypes.INTERNAL,
      title: 'Unknown error',
      status: 500,
      detail: 'An unknown error occurred.',
    };
  }

  // Get the string to parse
  let raw: string;
  if (typeof error === 'string') {
    raw = error;
  } else if (error instanceof Error) {
    raw = error.message;
  } else {
    raw = String(error);
  }

  // Attempt JSON parse
  if (raw.startsWith('{')) {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      // Validate it has at minimum the required fields
      if (
        typeof parsed.type === 'string' &&
        typeof parsed.title === 'string' &&
        typeof parsed.status === 'number' &&
        typeof parsed.detail === 'string'
      ) {
        return parsed as unknown as AppError;
      }
    } catch {
      // Fall through to plain string handling
    }
  }

  // Plain string fallback — wrap as internal error
  return {
    type: ErrorTypes.INTERNAL,
    title: 'Error',
    status: 500,
    detail: raw,
  };
}

/**
 * Detects both new format (type === "omniview:cancelled") and legacy ("cancelled" string).
 */
export function isCancelledError(error: unknown): boolean {
  if (error == null) return false;

  // Check raw string match first (legacy format)
  const raw = typeof error === 'string' ? error : error instanceof Error ? error.message : String(error);
  if (raw === 'cancelled') return true;

  // Check structured format
  const parsed = parseAppError(error);
  return parsed.type === ErrorTypes.CANCELLED;
}

/**
 * Converts an AppErrorAction into a { label, onClick } suitable for snackbar actions.
 */
export function actionToSnackbar(action: AppErrorAction): { label: string; onClick: () => void } {
  switch (action.type) {
    case 'navigate':
      return {
        label: action.label,
        onClick: () => { window.location.hash = action.target ?? ''; },
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
