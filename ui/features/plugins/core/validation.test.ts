import { describe, it, expect } from 'vitest';
import { validatePluginExports, validateResourceKeyFormat } from './validation';
import { PluginValidationError } from './errors';
import { PluginServiceError } from './errors';
import { PluginWindow } from '@omniviewdev/runtime';

// Helper: create a minimal valid PluginWindow
function pw() {
  return new PluginWindow();
}

// Stub component / factory
const SidebarStub = () => null;
const DrawerStub = () => ({ views: [] });

// ─── Group 1: Export Validation ──────────────────────────────────────

describe('validatePluginExports', () => {
  // ── 1.1 Happy Path ─────────────────────────────────────────────────

  describe('happy path', () => {
    it('#1 all fields present', () => {
      const reg = {
        extensionPointId: 'test-ep',
        registration: { id: 'c1', label: 'C1', value: SidebarStub },
      };
      const result = validatePluginExports({
        plugin: pw(),
        extensionRegistrations: [reg],
        sidebars: { 'core::v1::Pod': SidebarStub },
        drawers: { 'core::v1::Pod': DrawerStub },
      });
      expect(result.plugin).toBeDefined();
      expect(result.extensionRegistrations).toHaveLength(1);
      expect(Object.keys(result.sidebars)).toHaveLength(1);
      expect(Object.keys(result.drawers)).toHaveLength(1);
    });

    it('#2 minimal valid (plugin only)', () => {
      const result = validatePluginExports({ plugin: pw() });
      expect(result.plugin).toBeDefined();
      expect(result.extensionRegistrations).toEqual([]);
      expect(result.sidebars).toEqual({});
      expect(result.drawers).toEqual({});
    });

    it('#3 plugin with Routes array', () => {
      const p = pw();
      p.withRoutes([{ path: '/test', Component: SidebarStub }]);
      const result = validatePluginExports({ plugin: p });
      expect(result.plugin).toBeDefined();
    });

    it('#4 empty legacy shim maps', () => {
      const result = validatePluginExports({
        plugin: pw(),
        sidebars: {},
        drawers: {},
      });
      expect(result.sidebars).toEqual({});
      expect(result.drawers).toEqual({});
    });

    it('#5 generic extension registrations only', () => {
      const reg = {
        extensionPointId: 'test-ep',
        registration: { id: 'c1', label: 'C1', value: 'anything' },
      };
      const result = validatePluginExports({
        plugin: pw(),
        extensionRegistrations: [reg],
      });
      expect(result.extensionRegistrations).toHaveLength(1);
    });

    it('#6 extra/unexpected top-level fields tolerated', () => {
      const result = validatePluginExports({
        plugin: pw(),
        utils: {},
        helpers: () => {},
        version: '1.0',
      });
      expect(result.plugin).toBeDefined();
    });

    it('#7 extra fields on PluginWindow tolerated', () => {
      const p = pw() as any;
      p.customField = true;
      const result = validatePluginExports({ plugin: p });
      expect(result.plugin).toBeDefined();
    });
  });

  // ── 1.2 Missing/Null Exports ───────────────────────────────────────

  describe('missing/null exports', () => {
    it('#8 null exports', () => {
      expect(() => validatePluginExports(null)).toThrow(PluginValidationError);
      expect(() => validatePluginExports(null)).toThrow(/null/);
    });

    it('#9 undefined exports', () => {
      expect(() => validatePluginExports(undefined)).toThrow(PluginValidationError);
    });

    it('#10 non-object exports (string)', () => {
      expect(() => validatePluginExports('hello')).toThrow(PluginValidationError);
    });

    it('#11 non-object exports (number)', () => {
      expect(() => validatePluginExports(42)).toThrow(PluginValidationError);
    });

    it('#12 non-object exports (boolean)', () => {
      expect(() => validatePluginExports(true)).toThrow(PluginValidationError);
    });

    it('#13 empty object (missing plugin)', () => {
      expect(() => validatePluginExports({})).toThrow(/plugin/i);
    });

    it('#14 plugin is null', () => {
      expect(() => validatePluginExports({ plugin: null })).toThrow(PluginValidationError);
    });

    it('#15 plugin is undefined', () => {
      expect(() => validatePluginExports({ plugin: undefined })).toThrow(PluginValidationError);
    });

    it('#16 plugin is string', () => {
      expect(() => validatePluginExports({ plugin: 'not-a-plugin' })).toThrow(/object/);
    });

    it('#17 plugin is number', () => {
      expect(() => validatePluginExports({ plugin: 42 })).toThrow(PluginValidationError);
    });

    it('#18 plugin is function', () => {
      expect(() => validatePluginExports({ plugin: () => {} })).toThrow(PluginValidationError);
    });

    it('#19 plugin is array', () => {
      expect(() => validatePluginExports({ plugin: [] })).toThrow(PluginValidationError);
    });

    it('#20 extensionRegistrations is not array', () => {
      expect(() =>
        validatePluginExports({ plugin: pw(), extensionRegistrations: {} }),
      ).toThrow(/extensionRegistrations.*array/i);
    });
  });

  // ── 1.3 Routes Validation ──────────────────────────────────────────

  describe('routes validation', () => {
    it('#21 Routes is not array (string)', () => {
      expect(() =>
        validatePluginExports({ plugin: { Routes: 'bad' } }),
      ).toThrow(/Routes.*array/i);
    });

    it('#22 Routes is not array (object)', () => {
      expect(() =>
        validatePluginExports({ plugin: { Routes: {} } }),
      ).toThrow(/Routes.*array/i);
    });

    it('#23 Routes is not array (number)', () => {
      expect(() =>
        validatePluginExports({ plugin: { Routes: 5 } }),
      ).toThrow(/Routes.*array/i);
    });

    it('#24 Routes is empty array', () => {
      const p = pw();
      p.withRoutes([]);
      const result = validatePluginExports({ plugin: p });
      expect(result.plugin).toBeDefined();
    });

    it('#25 Routes absent', () => {
      const result = validatePluginExports({ plugin: pw() });
      expect(result.plugin).toBeDefined();
    });
  });

  // ── 1.4 Resource Key Validation ────────────────────────────────────

  describe('resource key validation (sidebars)', () => {
    it('#26 valid 3-part key', () => {
      const result = validatePluginExports({
        plugin: pw(),
        sidebars: { 'core::v1::Pod': SidebarStub },
      });
      expect(Object.keys(result.sidebars)).toContain('core::v1::Pod');
    });

    it('#27 valid key with dots', () => {
      const result = validatePluginExports({
        plugin: pw(),
        sidebars: { 'apps::v1::Deployment': SidebarStub },
      });
      expect(Object.keys(result.sidebars)).toContain('apps::v1::Deployment');
    });

    it('#28 valid key with extended group', () => {
      const result = validatePluginExports({
        plugin: pw(),
        sidebars: { 'networking.k8s.io::v1::NetworkPolicy': SidebarStub },
      });
      expect(Object.keys(result.sidebars)).toContain('networking.k8s.io::v1::NetworkPolicy');
    });

    it('#29 2-part key (missing group)', () => {
      expect(() =>
        validatePluginExports({ plugin: pw(), sidebars: { 'v1::Pod': SidebarStub } }),
      ).toThrow(/v1::Pod.*malformed.*GROUP::VERSION::KIND/);
    });

    it('#30 1-part key', () => {
      expect(() =>
        validatePluginExports({ plugin: pw(), sidebars: { Pod: SidebarStub } }),
      ).toThrow(/malformed/);
    });

    it('#31 empty string key', () => {
      expect(() =>
        validatePluginExports({ plugin: pw(), sidebars: { '': SidebarStub } }),
      ).toThrow();
    });

    it('#32 4-part key', () => {
      expect(() =>
        validatePluginExports({ plugin: pw(), sidebars: { 'a::b::c::d': SidebarStub } }),
      ).toThrow(/malformed/);
    });

    it('#33 key with wrong separator', () => {
      expect(() =>
        validatePluginExports({ plugin: pw(), sidebars: { 'core/v1/Pod': SidebarStub } }),
      ).toThrow(/malformed/);
    });

    it('#34 key with spaces', () => {
      expect(() =>
        validatePluginExports({ plugin: pw(), sidebars: { 'core :: v1 :: Pod': SidebarStub } }),
      ).toThrow(/malformed/);
    });

    it('#35 multiple keys, one bad', () => {
      expect(() =>
        validatePluginExports({
          plugin: pw(),
          sidebars: { 'core::v1::Pod': SidebarStub, bad: SidebarStub },
        }),
      ).toThrow(/bad/);
    });

    it('#36 same validation on drawers', () => {
      expect(() =>
        validatePluginExports({ plugin: pw(), drawers: { 'v1::Pod': DrawerStub } }),
      ).toThrow(/malformed.*GROUP::VERSION::KIND/);
    });

    it('#37 sidebar value is not function', () => {
      expect(() =>
        validatePluginExports({
          plugin: pw(),
          sidebars: { 'core::v1::Pod': 'string' as any },
        }),
      ).toThrow(/sidebar value.*must be a component/);
    });

    it('#38 drawer value is not function', () => {
      expect(() =>
        validatePluginExports({
          plugin: pw(),
          drawers: { 'core::v1::Pod': 42 as any },
        }),
      ).toThrow(/drawer value.*must be a factory function/);
    });
  });

  // ── 1.5 Error Type Hierarchy ───────────────────────────────────────

  describe('error type hierarchy', () => {
    it('#39 validation error is PluginValidationError', () => {
      try {
        validatePluginExports(null);
        expect.fail('should throw');
      } catch (e) {
        expect(e).toBeInstanceOf(PluginValidationError);
      }
    });

    it('#40 PluginValidationError extends PluginServiceError', () => {
      try {
        validatePluginExports(null);
        expect.fail('should throw');
      } catch (e) {
        expect(e).toBeInstanceOf(PluginServiceError);
      }
    });

    it('#41 validation error has pluginId field (when set from service context)', () => {
      // validatePluginExports itself doesn't set pluginId — the service does.
      // But the error class supports it.
      const err = new PluginValidationError('test', { pluginId: 'A', errors: ['bad'] });
      expect(err.pluginId).toBe('A');
    });

    it('#42 validation error has errors array', () => {
      try {
        validatePluginExports({ plugin: pw(), sidebars: { bad: SidebarStub } });
        expect.fail('should throw');
      } catch (e) {
        expect(e).toBeInstanceOf(PluginValidationError);
        expect((e as PluginValidationError).errors.length).toBeGreaterThan(0);
      }
    });
  });

  // ── 1.6 Extension Point Definition Validation ──────────────────────

  describe('extension point definition validation', () => {
    it('#43 duplicate extension point IDs within one plugin', () => {
      const p = pw();
      p.registerExtensionPoints([
        { id: 'my-ep', mode: 'multiple' },
        { id: 'my-ep', mode: 'single' },
      ]);
      expect(() => validatePluginExports({ plugin: p })).toThrow(/Duplicate extension point ID.*my-ep/);
    });

    it('#44 extension definition with missing id', () => {
      const p = pw();
      p.registerExtensionPoints([{} as any]);
      expect(() => validatePluginExports({ plugin: p })).toThrow(/id/);
    });

    it('#45 extension definition with non-string id', () => {
      const p = pw();
      p.registerExtensionPoints([{ id: 42 } as any]);
      expect(() => validatePluginExports({ plugin: p })).toThrow(/string.*id/);
    });
  });

  // ── 1.7 Dependencies Field Validation ─────────────────────────────

  describe('validatePluginExports — dependencies field', () => {
    it('accepts exports without dependencies (backward compatible)', () => {
      const result = validatePluginExports({ plugin: pw() });
      expect(result.plugin).toBeDefined();
    });

    it('accepts valid dependencies object', () => {
      const result = validatePluginExports({
        plugin: pw(),
        dependencies: { plugins: ['plugin-a', 'plugin-b'], extensionPoints: ['ep/1'] },
      });
      expect(result.plugin).toBeDefined();
    });

    it('accepts dependencies with only plugins', () => {
      const result = validatePluginExports({
        plugin: pw(),
        dependencies: { plugins: ['plugin-a'] },
      });
      expect(result.plugin).toBeDefined();
    });

    it('accepts dependencies with only extensionPoints', () => {
      const result = validatePluginExports({
        plugin: pw(),
        dependencies: { extensionPoints: ['ep/1'] },
      });
      expect(result.plugin).toBeDefined();
    });

    it('accepts empty dependencies object', () => {
      const result = validatePluginExports({
        plugin: pw(),
        dependencies: {},
      });
      expect(result.plugin).toBeDefined();
    });

    it('rejects non-object dependencies', () => {
      expect(() =>
        validatePluginExports({ plugin: pw(), dependencies: 'bad' }),
      ).toThrow(/dependencies.*object/i);
    });

    it('rejects dependencies.plugins that is not an array', () => {
      expect(() =>
        validatePluginExports({ plugin: pw(), dependencies: { plugins: 'not-array' } }),
      ).toThrow(/plugins.*array/i);
    });

    it('rejects dependencies.plugins with non-string items', () => {
      expect(() =>
        validatePluginExports({ plugin: pw(), dependencies: { plugins: [123] } }),
      ).toThrow(/plugins.*string/i);
    });

    it('rejects dependencies.extensionPoints that is not an array', () => {
      expect(() =>
        validatePluginExports({ plugin: pw(), dependencies: { extensionPoints: {} } }),
      ).toThrow(/extensionPoints.*array/i);
    });

    it('rejects dependencies.extensionPoints with non-string items', () => {
      expect(() =>
        validatePluginExports({ plugin: pw(), dependencies: { extensionPoints: [null] } }),
      ).toThrow(/extensionPoints.*string/i);
    });
  });
});

// ─── validateResourceKeyFormat ───────────────────────────────────────

describe('validateResourceKeyFormat', () => {
  it('accepts valid 3-part key', () => {
    expect(() => validateResourceKeyFormat('core::v1::Pod', 'sidebar')).not.toThrow();
  });

  it('rejects 2-part key', () => {
    expect(() => validateResourceKeyFormat('v1::Pod', 'sidebar')).toThrow(/malformed/);
  });

  it('rejects 1-part key', () => {
    expect(() => validateResourceKeyFormat('Pod', 'drawer')).toThrow(/malformed/);
  });

  it('rejects empty string', () => {
    expect(() => validateResourceKeyFormat('', 'sidebar')).toThrow();
  });

  it('rejects key with spaces', () => {
    expect(() => validateResourceKeyFormat('core :: v1 :: Pod', 'drawer')).toThrow(/malformed/);
  });
});
