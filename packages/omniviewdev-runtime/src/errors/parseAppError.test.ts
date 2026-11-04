import {
  parseAppError,
  isCancelledError,
  actionToNotification,
  createErrorHandler,
  showAppError,
} from './parseAppError';
import { ErrorTypes } from './types';
import type { AppErrorAction } from './types';

describe('parseAppError', () => {
  it('parses valid AppError JSON string', () => {
    const json = JSON.stringify({
      type: 'omniview:plugin/not-found',
      title: 'Plugin not found',
      status: 404,
      detail: "No plugin with id 'foo' was found.",
      instance: 'foo',
      suggestions: ['Check the plugin ID'],
      actions: [{ type: 'retry', label: 'Retry' }],
    });

    const result = parseAppError(json);
    expect(result.type).toBe(ErrorTypes.PLUGIN_NOT_FOUND);
    expect(result.title).toBe('Plugin not found');
    expect(result.status).toBe(404);
    expect(result.detail).toBe("No plugin with id 'foo' was found.");
    expect(result.instance).toBe('foo');
    expect(result.suggestions).toEqual(['Check the plugin ID']);
    expect(result.actions).toHaveLength(1);
  });

  it('replaces unclassified raw diagnostics with a safe internal error', () => {
    const result = parseAppError('something went wrong');
    expect(result.type).toBe(ErrorTypes.INTERNAL);
    expect(result.title).toBe('Error');
    expect(result.status).toBe(500);
    expect(result.detail).toBe('The operation could not be completed.');
  });

  it('handles Error object with .message', () => {
    const err = new Error('disk full');
    const result = parseAppError(err);
    expect(result.type).toBe(ErrorTypes.INTERNAL);
    expect(result.detail).toBe('The operation could not be completed.');
  });

  it('handles Error object with JSON .message', () => {
    const json = JSON.stringify({
      type: 'omniview:cancelled',
      title: 'Cancelled',
      status: 499,
      detail: 'The operation was cancelled by the user.',
    });
    const err = new Error(json);
    const result = parseAppError(err);
    expect(result.type).toBe(ErrorTypes.CANCELLED);
    expect(result.status).toBe(499);
  });

  it('handles null', () => {
    const result = parseAppError(null);
    expect(result.type).toBe(ErrorTypes.INTERNAL);
    expect(result.detail).toBe('An unknown error occurred.');
  });

  it('handles undefined', () => {
    const result = parseAppError(undefined);
    expect(result.type).toBe(ErrorTypes.INTERNAL);
    expect(result.detail).toBe('An unknown error occurred.');
  });

  it('handles malformed JSON gracefully', () => {
    const result = parseAppError('{not valid json}');
    expect(result.type).toBe(ErrorTypes.INTERNAL);
    expect(result.detail).toBe('The operation could not be completed.');
  });

  it('handles JSON missing required fields', () => {
    const result = parseAppError(JSON.stringify({ type: 'foo' }));
    expect(result.type).toBe(ErrorTypes.INTERNAL);
    expect(result.detail).toBe('The operation could not be completed.');
  });
});

describe('isCancelledError', () => {
  it('detects legacy "cancelled" string', () => {
    expect(isCancelledError('cancelled')).toBe(true);
  });

  it('detects structured cancelled error', () => {
    const json = JSON.stringify({
      type: 'omniview:cancelled',
      title: 'Cancelled',
      status: 499,
      detail: 'The operation was cancelled by the user.',
    });
    expect(isCancelledError(json)).toBe(true);
  });

  it('returns false for non-cancelled errors', () => {
    expect(isCancelledError('something else')).toBe(false);
  });

  it('returns false for null', () => {
    expect(isCancelledError(null)).toBe(false);
  });
});

describe('actionToNotification', () => {
  it('open-url action calls window.open', () => {
    const action: AppErrorAction = {
      type: 'open-url',
      label: 'Docs',
      target: 'https://example.com',
    };
    const originalOpen = window.open;
    const mockOpen = vi.fn();
    window.open = mockOpen;

    const result = actionToNotification(action);
    result!.onClick();
    expect(mockOpen).toHaveBeenCalledWith('https://example.com/', '_blank', 'noopener,noreferrer');

    window.open = originalOpen;
  });

  it('copy action writes to clipboard', () => {
    const action: AppErrorAction = { type: 'copy', label: 'Copy', target: 'abc123' };
    const mockWrite = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText: mockWrite } });

    const result = actionToNotification(action);
    result!.onClick();
    expect(mockWrite).toHaveBeenCalledWith('abc123');
  });

  it('omits retry without a real operation and rejects executable URLs', () => {
    expect(actionToNotification({ type: 'retry', label: 'Retry' })).toBeUndefined();
    expect(
      actionToNotification({ type: 'open-url', label: 'Unsafe', target: 'javascript:alert(1)' }),
    ).toBeUndefined();
  });
});

describe('createErrorHandler', () => {
  it('suppresses cancelled errors', () => {
    const notify = vi.fn();
    const handler = createErrorHandler(notify, 'Operation failed');

    handler('cancelled');
    expect(notify).not.toHaveBeenCalled();

    const json = JSON.stringify({
      type: 'omniview:cancelled',
      title: 'Cancelled',
      status: 499,
      detail: 'The operation was cancelled by the user.',
    });
    handler(json);
    expect(notify).not.toHaveBeenCalled();
  });

  it('shows structured error in notifications', () => {
    const notify = vi.fn();
    const handler = createErrorHandler(notify, 'Operation failed');

    const json = JSON.stringify({
      type: 'omniview:plugin/not-found',
      title: 'Plugin not found',
      status: 404,
      detail: "No plugin 'foo' was found.",
      suggestions: ['Check the ID'],
      actions: [{ type: 'navigate', label: 'Settings', target: '#/settings' }],
    });
    handler(json);

    expect(notify).toHaveBeenCalledTimes(1);
    const call = notify.mock.calls[0]![0];
    expect(call.title).toBe('Plugin not found');
    expect(call.severity).toBe('error');
    expect(call.details).toContain("No plugin 'foo' was found.");
    expect(call.details).toContain('• Check the ID');
    expect(call.actions).toHaveLength(1);
  });

  it('uses fallbackTitle for generic errors', () => {
    const notify = vi.fn();
    const handler = createErrorHandler(notify, 'Install failed');

    handler('something broke');

    const call = notify.mock.calls[0]![0];
    expect(call.title).toBe('Install failed');
    expect(call.details).toBe('The operation could not be completed.');
  });
});

describe('showAppError', () => {
  it('shows structured error with context message', () => {
    const notify = vi.fn();

    const json = JSON.stringify({
      type: 'omniview:plugin/not-found',
      title: 'Plugin not found',
      status: 404,
      detail: "No plugin 'foo' was found.",
      suggestions: ['Check the ID'],
      actions: [{ type: 'navigate', label: 'Settings', target: '#/settings' }],
    });
    showAppError(notify, json, 'Failed to delete pod-1');

    expect(notify).toHaveBeenCalledTimes(1);
    const call = notify.mock.calls[0]![0];
    expect(call.title).toBe('Failed to delete pod-1');
    expect(call.severity).toBe('error');
    expect(call.details).toContain("No plugin 'foo' was found.");
    expect(call.details).toContain('• Check the ID');
    expect(call.actions).toHaveLength(1);
  });

  it('uses appErr.title when no context message', () => {
    const notify = vi.fn();

    const json = JSON.stringify({
      type: 'omniview:session/not-found',
      title: 'Session not found',
      status: 404,
      detail: "Session 'abc' was not found.",
    });
    showAppError(notify, json);

    const call = notify.mock.calls[0]![0];
    expect(call.title).toBe('Session not found');
    expect(call.details).toBe("Session 'abc' was not found.");
  });

  it('suppresses cancelled errors', () => {
    const notify = vi.fn();

    showAppError(notify, 'cancelled');
    expect(notify).not.toHaveBeenCalled();
  });
});

describe('nested public error causes', () => {
  const cause = {
    type: ErrorTypes.PLUGIN_NOT_FOUND,
    title: 'Plugin not found',
    status: 404,
    detail: 'Install this plugin before opening its resources.',
  };

  it('keeps operation context while decoding escaped Wails causes', () => {
    const outer = {
      type: ErrorTypes.INTERNAL,
      title: 'Could not install plugin',
      status: 500,
      detail: `controller private context: ${JSON.stringify(cause)}`,
    };
    const error = parseAppError(new Error(JSON.stringify(JSON.stringify(outer))));
    expect(error.title).toBe(outer.title);
    expect(error.detail).toBe(`${cause.title}: ${cause.detail}`);
    expect(JSON.stringify(error)).not.toContain('private context');
  });

  it('decodes a public cause after Go operation context', () => {
    expect(parseAppError(`private controller context: ${JSON.stringify(cause)}`)).toEqual(cause);
  });

  it('does not expose malformed nested diagnostics or sensitive SDK fallback fields', () => {
    for (const detail of [
      '{private malformed JSON',
      JSON.stringify({ code: 'FORBIDDEN', title: 'secret', message: 'secret' }),
    ]) {
      const error = parseAppError({ ...cause, detail });
      expect(error.detail).not.toContain('private');
      expect(error.detail).not.toContain('secret');
      expect(error.detail).not.toContain('{');
    }
  });
});
