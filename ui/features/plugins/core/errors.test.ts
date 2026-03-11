import { describe, it, expect } from 'vitest';
import {
  PluginServiceError,
  PluginValidationError,
  PluginImportError,
  PluginTimeoutError,
  MissingExtensionPointError,
  DuplicateExtensionPointError,
} from './errors';

// ─── Group 14: Error Types ───────────────────────────────────────────

describe('Error Type Hierarchy', () => {
  // #4 All extend PluginServiceError
  describe('inheritance', () => {
    it('PluginValidationError extends PluginServiceError', () => {
      const err = new PluginValidationError('bad', { pluginId: 'A', errors: ['missing plugin'] });
      expect(err).toBeInstanceOf(PluginServiceError);
      expect(err).toBeInstanceOf(Error);
    });

    it('PluginImportError extends PluginServiceError', () => {
      const err = new PluginImportError('failed', { pluginId: 'A', url: 'http://x' });
      expect(err).toBeInstanceOf(PluginServiceError);
      expect(err).toBeInstanceOf(Error);
    });

    it('PluginTimeoutError extends PluginServiceError', () => {
      const err = new PluginTimeoutError('timed out', { pluginId: 'A', timeoutMs: 5000 });
      expect(err).toBeInstanceOf(PluginServiceError);
      expect(err).toBeInstanceOf(Error);
    });

    it('MissingExtensionPointError extends PluginServiceError', () => {
      const err = new MissingExtensionPointError('missing', {
        pluginId: 'A',
        extensionPointId: 'my-ep',
      });
      expect(err).toBeInstanceOf(PluginServiceError);
      expect(err).toBeInstanceOf(Error);
    });

    it('DuplicateExtensionPointError extends PluginServiceError', () => {
      const err = new DuplicateExtensionPointError('dup', {
        pluginId: 'B',
        extensionPointId: 'my-ep',
        ownerPluginId: 'A',
      });
      expect(err).toBeInstanceOf(PluginServiceError);
      expect(err).toBeInstanceOf(Error);
    });
  });

  // #1 PluginImportError
  describe('PluginImportError', () => {
    it('has pluginId and url', () => {
      const err = new PluginImportError('import failed', {
        pluginId: 'pluginA',
        url: 'http://localhost:5173/src/index.tsx',
      });
      expect(err.pluginId).toBe('pluginA');
      expect(err.url).toBe('http://localhost:5173/src/index.tsx');
      expect(err.message).toBe('import failed');
      expect(err.name).toBe('PluginImportError');
    });
  });

  // #2 PluginValidationError
  describe('PluginValidationError', () => {
    it('has errors array', () => {
      const err = new PluginValidationError('validation failed', {
        pluginId: 'A',
        errors: ['missing "plugin" export', 'sidebars value is not a function'],
      });
      expect(err.errors).toEqual([
        'missing "plugin" export',
        'sidebars value is not a function',
      ]);
      expect(err.pluginId).toBe('A');
      expect(err.name).toBe('PluginValidationError');
    });

    it('defaults errors to empty array', () => {
      const err = new PluginValidationError('bad');
      expect(err.errors).toEqual([]);
    });
  });

  // #3 PluginTimeoutError
  describe('PluginTimeoutError', () => {
    it('has timeoutMs', () => {
      const err = new PluginTimeoutError('timed out', {
        pluginId: 'A',
        timeoutMs: 30000,
      });
      expect(err.timeoutMs).toBe(30000);
      expect(err.pluginId).toBe('A');
      expect(err.name).toBe('PluginTimeoutError');
    });
  });

  // #5 error.message stored in state (contract test — just check message is accessible)
  describe('message', () => {
    it('message is accessible as a string', () => {
      const err = new PluginServiceError('something went wrong', { pluginId: 'X' });
      expect(typeof err.message).toBe('string');
      expect(err.message).toBe('something went wrong');
    });
  });

  // #6 Nested error preserved
  describe('cause chain', () => {
    it('preserves nested cause', () => {
      const root = new Error('network failure');
      const err = new PluginImportError('import failed', {
        pluginId: 'A',
        cause: root,
      });
      expect(err.cause).toBe(root);
    });

    it('preserves multi-level cause chain', () => {
      const root = new Error('dns');
      const mid = new PluginImportError('fetch failed', {
        pluginId: 'A',
        cause: root,
      });
      const top = new PluginServiceError('load failed', {
        pluginId: 'A',
        cause: mid,
      });
      expect(top.cause).toBe(mid);
      expect((top.cause as PluginImportError).cause).toBe(root);
    });
  });

  // #7 Error includes pluginId
  describe('pluginId', () => {
    it('all error types have pluginId', () => {
      const errors = [
        new PluginServiceError('a', { pluginId: 'P' }),
        new PluginValidationError('b', { pluginId: 'P' }),
        new PluginImportError('c', { pluginId: 'P' }),
        new PluginTimeoutError('d', { pluginId: 'P', timeoutMs: 100 }),
        new MissingExtensionPointError('e', { pluginId: 'P', extensionPointId: 'ep' }),
        new DuplicateExtensionPointError('f', { pluginId: 'P', extensionPointId: 'ep' }),
      ];
      for (const err of errors) {
        expect(err.pluginId).toBe('P');
      }
    });
  });

  // #8 MissingExtensionPointError
  describe('MissingExtensionPointError', () => {
    it('has extensionPointId', () => {
      const err = new MissingExtensionPointError(
        'Missing extension point: omniview/custom/ep',
        { pluginId: 'A', extensionPointId: 'omniview/custom/ep' },
      );
      expect(err.extensionPointId).toBe('omniview/custom/ep');
      expect(err.pluginId).toBe('A');
      expect(err.name).toBe('MissingExtensionPointError');
    });
  });

  // #9 DuplicateExtensionPointError
  describe('DuplicateExtensionPointError', () => {
    it('has extensionPointId and ownerPluginId', () => {
      const err = new DuplicateExtensionPointError(
        'Extension point "my-ep" already owned by "pluginA"',
        {
          pluginId: 'pluginB',
          extensionPointId: 'my-ep',
          ownerPluginId: 'pluginA',
        },
      );
      expect(err.extensionPointId).toBe('my-ep');
      expect(err.ownerPluginId).toBe('pluginA');
      expect(err.pluginId).toBe('pluginB');
      expect(err.name).toBe('DuplicateExtensionPointError');
    });
  });

  // Name property
  describe('name property', () => {
    it('each error type has a distinct name', () => {
      expect(new PluginServiceError('x').name).toBe('PluginServiceError');
      expect(new PluginValidationError('x').name).toBe('PluginValidationError');
      expect(new PluginImportError('x').name).toBe('PluginImportError');
      expect(
        new PluginTimeoutError('x', { pluginId: 'A', timeoutMs: 1 }).name,
      ).toBe('PluginTimeoutError');
      expect(
        new MissingExtensionPointError('x', { pluginId: 'A', extensionPointId: 'e' }).name,
      ).toBe('MissingExtensionPointError');
      expect(
        new DuplicateExtensionPointError('x', { extensionPointId: 'e' }).name,
      ).toBe('DuplicateExtensionPointError');
    });
  });
});
