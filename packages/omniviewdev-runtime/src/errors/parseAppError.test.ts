import { parseAppError, isCancelledError, actionToSnackbar, createErrorHandler } from './parseAppError';
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

  it('handles plain string (Wails legacy) — wraps as internal error', () => {
    const result = parseAppError('something went wrong');
    expect(result.type).toBe(ErrorTypes.INTERNAL);
    expect(result.title).toBe('Error');
    expect(result.status).toBe(500);
    expect(result.detail).toBe('something went wrong');
  });

  it('handles Error object with .message', () => {
    const err = new Error('disk full');
    const result = parseAppError(err);
    expect(result.type).toBe(ErrorTypes.INTERNAL);
    expect(result.detail).toBe('disk full');
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
    expect(result.detail).toBe('{not valid json}');
  });

  it('handles JSON missing required fields', () => {
    const result = parseAppError(JSON.stringify({ type: 'foo' }));
    expect(result.type).toBe(ErrorTypes.INTERNAL);
    // Falls back to plain string since required fields are missing
    expect(result.detail).toContain('foo');
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

describe('actionToSnackbar', () => {
  it('navigate action sets window.location.hash', () => {
    const action: AppErrorAction = { type: 'navigate', label: 'Settings', target: '#/settings' };
    const result = actionToSnackbar(action);
    expect(result.label).toBe('Settings');
    expect(typeof result.onClick).toBe('function');
  });

  it('open-url action calls window.open', () => {
    const action: AppErrorAction = { type: 'open-url', label: 'Docs', target: 'https://example.com' };
    const originalOpen = window.open;
    const mockOpen = jest.fn();
    window.open = mockOpen;

    const result = actionToSnackbar(action);
    result.onClick();
    expect(mockOpen).toHaveBeenCalledWith('https://example.com', '_blank');

    window.open = originalOpen;
  });

  it('copy action writes to clipboard', () => {
    const action: AppErrorAction = { type: 'copy', label: 'Copy', target: 'abc123' };
    const mockWrite = jest.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText: mockWrite } });

    const result = actionToSnackbar(action);
    result.onClick();
    expect(mockWrite).toHaveBeenCalledWith('abc123');
  });

  it('retry action returns callable stub', () => {
    const action: AppErrorAction = { type: 'retry', label: 'Retry' };
    const result = actionToSnackbar(action);
    expect(result.label).toBe('Retry');
    expect(() => result.onClick()).not.toThrow();
  });
});

describe('createErrorHandler', () => {
  it('suppresses cancelled errors', () => {
    const showSnackbar = jest.fn();
    const handler = createErrorHandler(showSnackbar, 'Operation failed');

    handler('cancelled');
    expect(showSnackbar).not.toHaveBeenCalled();

    const json = JSON.stringify({
      type: 'omniview:cancelled',
      title: 'Cancelled',
      status: 499,
      detail: 'The operation was cancelled by the user.',
    });
    handler(json);
    expect(showSnackbar).not.toHaveBeenCalled();
  });

  it('shows structured error in snackbar', () => {
    const showSnackbar = jest.fn();
    const handler = createErrorHandler(showSnackbar, 'Operation failed');

    const json = JSON.stringify({
      type: 'omniview:plugin/not-found',
      title: 'Plugin not found',
      status: 404,
      detail: "No plugin 'foo' was found.",
      suggestions: ['Check the ID'],
      actions: [{ type: 'navigate', label: 'Settings', target: '#/settings' }],
    });
    handler(json);

    expect(showSnackbar).toHaveBeenCalledTimes(1);
    const call = showSnackbar.mock.calls[0]![0];
    expect(call.message).toBe('Plugin not found');
    expect(call.status).toBe('error');
    expect(call.details).toContain("No plugin 'foo' was found.");
    expect(call.details).toContain('• Check the ID');
    expect(call.actions).toHaveLength(1);
  });

  it('uses fallbackTitle for generic errors', () => {
    const showSnackbar = jest.fn();
    const handler = createErrorHandler(showSnackbar, 'Install failed');

    handler('something broke');

    const call = showSnackbar.mock.calls[0]![0];
    expect(call.message).toBe('Install failed');
    expect(call.details).toBe('something broke');
  });
});

describe('showAppError', () => {
  it('shows structured error with context message', () => {
    const { showAppError } = require('./parseAppError');
    const showSnackbar = jest.fn();

    const json = JSON.stringify({
      type: 'omniview:plugin/not-found',
      title: 'Plugin not found',
      status: 404,
      detail: "No plugin 'foo' was found.",
      suggestions: ['Check the ID'],
      actions: [{ type: 'navigate', label: 'Settings', target: '#/settings' }],
    });
    showAppError(showSnackbar, json, 'Failed to delete pod-1');

    expect(showSnackbar).toHaveBeenCalledTimes(1);
    const call = showSnackbar.mock.calls[0]![0];
    expect(call.message).toBe('Failed to delete pod-1');
    expect(call.status).toBe('error');
    expect(call.details).toContain("No plugin 'foo' was found.");
    expect(call.details).toContain('• Check the ID');
    expect(call.actions).toHaveLength(1);
  });

  it('uses appErr.title when no context message', () => {
    const { showAppError } = require('./parseAppError');
    const showSnackbar = jest.fn();

    const json = JSON.stringify({
      type: 'omniview:session/not-found',
      title: 'Session not found',
      status: 404,
      detail: "Session 'abc' was not found.",
    });
    showAppError(showSnackbar, json);

    const call = showSnackbar.mock.calls[0]![0];
    expect(call.message).toBe('Session not found');
    expect(call.details).toBe("Session 'abc' was not found.");
  });

  it('suppresses cancelled errors', () => {
    const { showAppError } = require('./parseAppError');
    const showSnackbar = jest.fn();

    showAppError(showSnackbar, 'cancelled');
    expect(showSnackbar).not.toHaveBeenCalled();
  });
});
