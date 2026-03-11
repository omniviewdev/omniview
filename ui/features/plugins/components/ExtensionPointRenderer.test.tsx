/**
 * Tests for ExtensionPointRenderer and PluginSurfaceBoundary.
 *
 * Covers:
 * - Group 13.6: ExtensionPointRenderer component
 * - Group 16: Component isolation
 * - Group 18.11–18.13: Boundary logging observability
 */
import React from 'react';
import { render, screen, cleanup, act } from '@testing-library/react';
import { ExtensionPointRegistry, ExtensionProvider } from '@omniviewdev/runtime';

import { ExtensionPointRenderer } from './ExtensionPointRenderer';
import {
  PluginSurfaceBoundary,
  DefaultExtensionFallback,
  DefaultPluginFallback,
  logPluginBoundaryError,
} from './PluginSurfaceBoundary';
import type {
  DefaultExtensionFallbackProps,
  DefaultPluginFallbackProps,
} from './PluginSurfaceBoundary';

// ─── Helpers ────────────────────────────────────────────────────────

function createRegistry(): ExtensionPointRegistry {
  return new ExtensionPointRegistry();
}

function renderWithRegistry(
  registry: ExtensionPointRegistry,
  ui: React.ReactElement,
) {
  return render(
    <ExtensionProvider registry={registry}>{ui}</ExtensionProvider>,
  );
}

/** A component that always throws on render. */
function CrashingComponent(): React.ReactElement {
  throw new Error('Component crash!');
}

/** A component that throws in useEffect. */
function EffectCrashComponent(): React.ReactElement {
  React.useEffect(() => {
    throw new Error('Effect crash!');
  }, []);
  return <div>should not stay</div>;
}

const TEST_EP_ID = 'test/extension-point';

function setupMultipleEP(registry: ExtensionPointRegistry) {
  registry.addExtensionPoint({
    id: TEST_EP_ID,
    pluginId: 'core',
    mode: 'multiple',
  });
}

function setupSingleEP(registry: ExtensionPointRegistry) {
  registry.addExtensionPoint({
    id: TEST_EP_ID,
    pluginId: 'core',
    mode: 'single',
    matcher: (contrib, ctx) => {
      const meta = contrib.meta as { key?: string } | undefined;
      const ctxKey = (ctx as any)?.key;
      return meta?.key === ctxKey;
    },
  });
}

function registerComponent(
  registry: ExtensionPointRegistry,
  id: string,
  plugin: string,
  Component: React.ComponentType<any>,
  meta?: unknown,
) {
  const store = registry.getExtensionPoint(TEST_EP_ID);
  store!.register({
    id,
    plugin,
    label: id,
    value: Component,
    meta,
  });
}

// Suppress console.error from ErrorBoundary/React (expected in crash tests)
let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  consoleErrorSpy.mockRestore();
  cleanup();
});

// ─── Group 13.6: ExtensionPointRenderer Component ───────────────────

describe('Group 13.6: ExtensionPointRenderer', () => {
  // 13.6.32: Renders matched components
  test('renders matched components', () => {
    const registry = createRegistry();
    setupMultipleEP(registry);
    registerComponent(registry, 'comp-a', 'plugin-a', () => <div data-testid="a">A</div>);
    registerComponent(registry, 'comp-b', 'plugin-b', () => <div data-testid="b">B</div>);

    renderWithRegistry(
      registry,
      <ExtensionPointRenderer extensionPointId={TEST_EP_ID} />,
    );

    expect(screen.getByTestId('a')).toBeInTheDocument();
    expect(screen.getByTestId('b')).toBeInTheDocument();
  });

  // 13.6.33: ErrorBoundary per component — crash isolated
  test('crash in one component does not affect sibling', () => {
    const registry = createRegistry();
    setupMultipleEP(registry);
    registerComponent(registry, 'crash', 'plugin-crash', CrashingComponent);
    registerComponent(registry, 'good', 'plugin-good', () => <div data-testid="survivor">OK</div>);

    renderWithRegistry(
      registry,
      <ExtensionPointRenderer extensionPointId={TEST_EP_ID} />,
    );

    // Good component survives
    expect(screen.getByTestId('survivor')).toBeInTheDocument();
    // Fallback visible for crashed component
    expect(screen.getByText(/Extension Error/)).toBeInTheDocument();
  });

  // 13.6.34: Fallback includes plugin name
  test('fallback mentions plugin name', () => {
    const registry = createRegistry();
    setupMultipleEP(registry);
    registerComponent(registry, 'crash', 'my-crashing-plugin', CrashingComponent);

    renderWithRegistry(
      registry,
      <ExtensionPointRenderer extensionPointId={TEST_EP_ID} />,
    );

    expect(screen.getByText(/my-crashing-plugin/)).toBeInTheDocument();
  });

  // 13.6.35: No matches → empty render
  test('renders nothing when no registrations', () => {
    const registry = createRegistry();
    setupMultipleEP(registry);

    const { container } = renderWithRegistry(
      registry,
      <ExtensionPointRenderer extensionPointId={TEST_EP_ID} />,
    );

    expect(container.innerHTML).toBe('');
  });

  // 13.6.36: Single mode → one matched value
  test('single mode renders only matched value', () => {
    const registry = createRegistry();
    setupSingleEP(registry);
    registerComponent(
      registry, 'match', 'plugin-a',
      () => <div data-testid="matched">matched</div>,
      { key: 'target' },
    );
    registerComponent(
      registry, 'no-match', 'plugin-b',
      () => <div data-testid="not-matched">not-matched</div>,
      { key: 'other' },
    );

    const context = { key: 'target', getCacheKey: () => 'target' } as any;
    renderWithRegistry(
      registry,
      <ExtensionPointRenderer extensionPointId={TEST_EP_ID} context={context} />,
    );

    expect(screen.getByTestId('matched')).toBeInTheDocument();
    expect(screen.queryByTestId('not-matched')).not.toBeInTheDocument();
  });

  // 13.6.37: Multiple mode → all matched values
  test('multiple mode renders all matched values', () => {
    const registry = createRegistry();
    setupMultipleEP(registry);
    registerComponent(registry, 'a', 'plugin-a', () => <div data-testid="a">A</div>);
    registerComponent(registry, 'b', 'plugin-b', () => <div data-testid="b">B</div>);
    registerComponent(registry, 'c', 'plugin-c', () => <div data-testid="c">C</div>);

    renderWithRegistry(
      registry,
      <ExtensionPointRenderer extensionPointId={TEST_EP_ID} />,
    );

    expect(screen.getByTestId('a')).toBeInTheDocument();
    expect(screen.getByTestId('b')).toBeInTheDocument();
    expect(screen.getByTestId('c')).toBeInTheDocument();
  });

  // 13.6.38: Custom fallback prop
  test('custom fallback is used when provided', () => {
    const registry = createRegistry();
    setupMultipleEP(registry);
    registerComponent(registry, 'crash', 'plugin-crash', CrashingComponent);

    function CustomFallback({ error, pluginId }: DefaultExtensionFallbackProps) {
      return <div data-testid="custom-fallback">Custom: {pluginId} - {error.message}</div>;
    }

    renderWithRegistry(
      registry,
      <ExtensionPointRenderer extensionPointId={TEST_EP_ID} fallback={CustomFallback} />,
    );

    expect(screen.getByTestId('custom-fallback')).toBeInTheDocument();
    expect(screen.getByText(/Custom: plugin-crash/)).toBeInTheDocument();
  });

  // 13.6.39: Error boundary resets on contribution replacement (plugin reload)
  test('error boundary resets when contribution ID changes', () => {
    const registry = createRegistry();
    setupMultipleEP(registry);
    const store = registry.getExtensionPoint(TEST_EP_ID)!;

    // Register a crashing component
    store.register({
      id: 'comp-1',
      plugin: 'plugin-a',
      label: 'comp-1',
      value: CrashingComponent,
    });

    renderWithRegistry(
      registry,
      <ExtensionPointRenderer extensionPointId={TEST_EP_ID} />,
    );

    // Fallback should be visible
    expect(screen.getByText(/Extension Error/)).toBeInTheDocument();

    // Simulate plugin reload: unregister old, register working component with new ID.
    // Must wrap in act() so useSyncExternalStore processes the subscription notification.
    act(() => {
      store.unregister('comp-1');
      store.register({
        id: 'comp-1-v2',
        plugin: 'plugin-a',
        label: 'comp-1-v2',
        value: () => <div data-testid="recovered">recovered</div>,
      });
    });

    // New component should render without fallback — the key changed from
    // 'comp-1' to 'comp-1-v2', so React unmounted the old ErrorBoundary.
    expect(screen.getByTestId('recovered')).toBeInTheDocument();
  });

  // 13.6.40: Default fallback is visible in production mode
  test('default fallback is visible (not null) in production', () => {
    const registry = createRegistry();
    setupMultipleEP(registry);
    registerComponent(registry, 'crash', 'plugin-crash', CrashingComponent);

    renderWithRegistry(
      registry,
      <ExtensionPointRenderer extensionPointId={TEST_EP_ID} />,
    );

    // Must be visible, not collapsed to null
    const alert = screen.getByRole('alert');
    expect(alert).toBeInTheDocument();
    expect(alert.textContent).toContain('Extension Error');
  });

  // 13.6.41: Fallback receives plugin and contribution context
  test('fallback props include pluginId, extensionPointId, contributionId', () => {
    const registry = createRegistry();
    setupMultipleEP(registry);
    registerComponent(registry, 'crash-contrib', 'plugin-x', CrashingComponent);

    let capturedProps: DefaultExtensionFallbackProps | null = null;
    function CaptureFallback(props: DefaultExtensionFallbackProps) {
      capturedProps = props;
      return <div>captured</div>;
    }

    renderWithRegistry(
      registry,
      <ExtensionPointRenderer extensionPointId={TEST_EP_ID} fallback={CaptureFallback} />,
    );

    expect(capturedProps).not.toBeNull();
    expect(capturedProps!.pluginId).toBe('plugin-x');
    expect(capturedProps!.extensionPointId).toBe(TEST_EP_ID);
    expect(capturedProps!.contributionId).toBe('crash-contrib');
    expect(capturedProps!.error).toBeInstanceOf(Error);
  });

  // Extension point that doesn't exist → renders nothing
  test('missing extension point renders nothing', () => {
    const registry = createRegistry();
    const { container } = renderWithRegistry(
      registry,
      <ExtensionPointRenderer extensionPointId="nonexistent/ep" />,
    );
    expect(container.innerHTML).toBe('');
  });
});

// ─── Group 16: Component Isolation ──────────────────────────────────

describe('Group 16: Component Isolation', () => {
  // 16.1: Plugin A sidebar crash → Plugin B sidebar fine
  test('plugin A crash does not affect plugin B in same extension point', () => {
    const registry = createRegistry();
    setupMultipleEP(registry);
    registerComponent(registry, 'a-sidebar', 'plugin-a', CrashingComponent);
    registerComponent(registry, 'b-sidebar', 'plugin-b', () => <div data-testid="b-ok">B OK</div>);

    renderWithRegistry(
      registry,
      <ExtensionPointRenderer extensionPointId={TEST_EP_ID} />,
    );

    expect(screen.getByTestId('b-ok')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  // 16.3: ErrorBoundary catches render error
  test('ErrorBoundary catches render error and shows fallback', () => {
    const registry = createRegistry();
    setupMultipleEP(registry);
    registerComponent(registry, 'crash', 'plugin-crash', CrashingComponent);

    renderWithRegistry(
      registry,
      <ExtensionPointRenderer extensionPointId={TEST_EP_ID} />,
    );

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/Component crash!/)).toBeInTheDocument();
  });

  // 16.4: ErrorBoundary catches effect error
  test('ErrorBoundary catches effect error', () => {
    const registry = createRegistry();
    setupMultipleEP(registry);
    registerComponent(registry, 'effect-crash', 'plugin-effect', EffectCrashComponent);

    renderWithRegistry(
      registry,
      <ExtensionPointRenderer extensionPointId={TEST_EP_ID} />,
    );

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/Effect crash!/)).toBeInTheDocument();
  });

  // 16.5: Crashed component recoverable on reload
  test('crashed component recovers after reload (new registration)', () => {
    const registry = createRegistry();
    setupMultipleEP(registry);
    const store = registry.getExtensionPoint(TEST_EP_ID)!;

    store.register({
      id: 'comp',
      plugin: 'plugin-a',
      label: 'comp',
      value: CrashingComponent,
    });

    renderWithRegistry(
      registry,
      <ExtensionPointRenderer extensionPointId={TEST_EP_ID} />,
    );

    expect(screen.getByRole('alert')).toBeInTheDocument();

    // Simulate reload: remove old, add new working component.
    // act() ensures useSyncExternalStore processes the subscription notification.
    act(() => {
      store.unregister('comp');
      store.register({
        id: 'comp-v2',
        plugin: 'plugin-a',
        label: 'comp-v2',
        value: () => <div data-testid="recovered">recovered</div>,
      });
    });

    expect(screen.getByTestId('recovered')).toBeInTheDocument();
  });

  // 16.7: Nested plugin crash contained
  test('nested contribution crash is contained by its own boundary', () => {
    const registry = createRegistry();
    setupMultipleEP(registry);

    // Plugin A renders OK
    registerComponent(registry, 'a-comp', 'plugin-a', () => <div data-testid="a-ok">A OK</div>);
    // Plugin B crashes
    registerComponent(registry, 'b-comp', 'plugin-b', CrashingComponent);

    renderWithRegistry(
      registry,
      <ExtensionPointRenderer extensionPointId={TEST_EP_ID} />,
    );

    expect(screen.getByTestId('a-ok')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  // 16.8: Drawer-local crash keeps drawer chrome alive
  test('PluginSurfaceBoundary keeps drawer chrome alive on crash', () => {
    render(
      <div data-testid="drawer-chrome">
        <div>Drawer Header</div>
        <PluginSurfaceBoundary pluginId="plugin-x" boundary="drawer-surface" resourceKey="core::v1::Pod">
          <CrashingComponent />
        </PluginSurfaceBoundary>
        <div data-testid="drawer-footer">Drawer Footer</div>
      </div>,
    );

    // Chrome survives
    expect(screen.getByTestId('drawer-chrome')).toBeInTheDocument();
    expect(screen.getByTestId('drawer-footer')).toBeInTheDocument();
    // Fallback shown locally
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/Plugin Error/)).toBeInTheDocument();
    expect(screen.getByText(/plugin-x/)).toBeInTheDocument();
    expect(screen.getByText(/drawer-surface/)).toBeInTheDocument();
  });

  // 16.9: Modal-local crash keeps modal shell alive
  test('PluginSurfaceBoundary keeps modal shell alive on crash', () => {
    render(
      <div data-testid="modal-shell">
        <div>Modal Title</div>
        <PluginSurfaceBoundary pluginId="plugin-y" boundary="modal-surface">
          <CrashingComponent />
        </PluginSurfaceBoundary>
      </div>,
    );

    expect(screen.getByTestId('modal-shell')).toBeInTheDocument();
    expect(screen.getByText('Modal Title')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/plugin-y/)).toBeInTheDocument();
  });
});

// ─── Group 18.11–18.13: Boundary Logging ────────────────────────────

describe('Group 18: Boundary Logging', () => {
  // 18.11: Extension boundary crash log includes extension context
  test('extension boundary crash emits structured log with extension context', () => {
    const registry = createRegistry();
    setupMultipleEP(registry);
    registerComponent(registry, 'crash-contrib', 'plugin-log-test', CrashingComponent);

    renderWithRegistry(
      registry,
      <ExtensionPointRenderer extensionPointId={TEST_EP_ID} />,
    );

    // logPluginBoundaryError calls console.error with structured data
    const errorCalls = consoleErrorSpy.mock.calls;
    const boundaryCall = errorCalls.find(
      (call) => typeof call[0] === 'string' && call[0].includes('[PluginBoundary]'),
    );

    expect(boundaryCall).toBeDefined();
    expect(boundaryCall![0]).toContain('plugin-log-test');
    expect(boundaryCall![0]).toContain('ExtensionPointRenderer');

    // Second argument is the structured context
    const context = boundaryCall![1] as Record<string, unknown>;
    expect(context.pluginId).toBe('plugin-log-test');
    expect(context.extensionPointId).toBe(TEST_EP_ID);
    expect(context.contributionId).toBe('crash-contrib');
    expect(context.componentStack).toBeDefined();
  });

  // 18.12: Plugin route crash log includes plugin boundary context
  test('plugin surface boundary crash emits structured log with boundary context', () => {
    render(
      <PluginSurfaceBoundary pluginId="plugin-route-test" boundary="plugin-route">
        <CrashingComponent />
      </PluginSurfaceBoundary>,
    );

    const errorCalls = consoleErrorSpy.mock.calls;
    const boundaryCall = errorCalls.find(
      (call) => typeof call[0] === 'string' && call[0].includes('[PluginBoundary]'),
    );

    expect(boundaryCall).toBeDefined();
    expect(boundaryCall![0]).toContain('plugin-route-test');
    expect(boundaryCall![0]).toContain('plugin-route');

    const context = boundaryCall![1] as Record<string, unknown>;
    expect(context.pluginId).toBe('plugin-route-test');
    expect(context.boundary).toBe('plugin-route');
  });

  // 18.13: Drawer/modal boundary crash log includes resource context
  test('drawer boundary crash emits structured log with resourceKey', () => {
    render(
      <PluginSurfaceBoundary pluginId="plugin-drawer" boundary="drawer-surface" resourceKey="core::v1::Pod">
        <CrashingComponent />
      </PluginSurfaceBoundary>,
    );

    const errorCalls = consoleErrorSpy.mock.calls;
    const boundaryCall = errorCalls.find(
      (call) => typeof call[0] === 'string' && call[0].includes('[PluginBoundary]'),
    );

    expect(boundaryCall).toBeDefined();
    const context = boundaryCall![1] as Record<string, unknown>;
    expect(context.pluginId).toBe('plugin-drawer');
    expect(context.boundary).toBe('drawer-surface');
    expect(context.resourceKey).toBe('core::v1::Pod');
  });

  // logPluginBoundaryError unit test
  test('logPluginBoundaryError emits structured console.error', () => {
    logPluginBoundaryError({
      pluginId: 'test-plugin',
      boundary: 'test-boundary',
      extensionPointId: 'test-ep',
      contributionId: 'test-contrib',
      resourceKey: 'core::v1::Service',
      message: 'test error',
      stack: 'stack trace',
      componentStack: 'component stack',
    });

    const errorCalls = consoleErrorSpy.mock.calls;
    const call = errorCalls.find(
      (c) => typeof c[0] === 'string' && c[0].includes('test-plugin'),
    );

    expect(call).toBeDefined();
    const ctx = call![1] as Record<string, unknown>;
    expect(ctx.pluginId).toBe('test-plugin');
    expect(ctx.boundary).toBe('test-boundary');
    expect(ctx.extensionPointId).toBe('test-ep');
    expect(ctx.contributionId).toBe('test-contrib');
    expect(ctx.resourceKey).toBe('core::v1::Service');
    expect(ctx.stack).toBe('stack trace');
    expect(ctx.componentStack).toBe('component stack');
  });
});

// ─── DefaultExtensionFallback and DefaultPluginFallback unit tests ──

describe('Fallback Components', () => {
  test('DefaultExtensionFallback renders all context', () => {
    render(
      <DefaultExtensionFallback
        error={new Error('boom')}
        pluginId="test-plugin"
        extensionPointId="test-ep"
        contributionId="test-contrib"
      />,
    );

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/Extension Error/)).toBeInTheDocument();
    expect(screen.getByText(/test-plugin/)).toBeInTheDocument();
    expect(screen.getByText(/test-ep/)).toBeInTheDocument();
    expect(screen.getByText(/test-contrib/)).toBeInTheDocument();
    expect(screen.getByText(/boom/)).toBeInTheDocument();
  });

  test('DefaultPluginFallback renders all context', () => {
    render(
      <DefaultPluginFallback
        error={new Error('crash')}
        pluginId="test-plugin"
        boundary="drawer-surface"
        resourceKey="core::v1::Pod"
      />,
    );

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/Plugin Error/)).toBeInTheDocument();
    expect(screen.getByText(/test-plugin/)).toBeInTheDocument();
    expect(screen.getByText(/drawer-surface/)).toBeInTheDocument();
    expect(screen.getByText(/core::v1::Pod/)).toBeInTheDocument();
    expect(screen.getByText(/crash/)).toBeInTheDocument();
  });

  test('DefaultPluginFallback omits resourceKey when not provided', () => {
    render(
      <DefaultPluginFallback
        error={new Error('err')}
        pluginId="p"
        boundary="modal-surface"
      />,
    );

    expect(screen.queryByText(/Resource:/)).not.toBeInTheDocument();
  });
});

// ─── PluginSurfaceBoundary additional tests ─────────────────────────

describe('PluginSurfaceBoundary', () => {
  test('renders children when no error', () => {
    render(
      <PluginSurfaceBoundary pluginId="test" boundary="drawer-surface">
        <div data-testid="child">Hello</div>
      </PluginSurfaceBoundary>,
    );

    expect(screen.getByTestId('child')).toBeInTheDocument();
  });

  test('custom fallback is used when provided', () => {
    function CustomFallback({ pluginId }: DefaultPluginFallbackProps) {
      return <div data-testid="custom">Custom: {pluginId}</div>;
    }

    render(
      <PluginSurfaceBoundary pluginId="test" boundary="drawer-surface" fallback={CustomFallback}>
        <CrashingComponent />
      </PluginSurfaceBoundary>,
    );

    expect(screen.getByTestId('custom')).toBeInTheDocument();
    expect(screen.getByText(/Custom: test/)).toBeInTheDocument();
  });

  test('resets boundary when resetKeys change', () => {
    let shouldCrash = true;

    function MaybeCrash() {
      if (shouldCrash) throw new Error('crash');
      return <div data-testid="ok">OK</div>;
    }

    const { rerender } = render(
      <PluginSurfaceBoundary pluginId="test" boundary="plugin-route" resetKeys={['key-1']}>
        <MaybeCrash />
      </PluginSurfaceBoundary>,
    );

    expect(screen.getByRole('alert')).toBeInTheDocument();

    // Fix the component and change reset key
    shouldCrash = false;
    rerender(
      <PluginSurfaceBoundary pluginId="test" boundary="plugin-route" resetKeys={['key-2']}>
        <MaybeCrash />
      </PluginSurfaceBoundary>,
    );

    expect(screen.getByTestId('ok')).toBeInTheDocument();
  });
});

// ─── Group 13.5: Runtime Reactivity (29-31) ─────────────────────────

describe('Group 13.5: ExtensionPointRenderer reactivity', () => {
  // 13.5.29: Mounted renderer rerenders when matching contribution added
  test('renderer updates when matching contribution is added', () => {
    const registry = createRegistry();
    setupMultipleEP(registry);

    renderWithRegistry(
      registry,
      <ExtensionPointRenderer extensionPointId={TEST_EP_ID} />,
    );

    // Initially empty
    expect(screen.queryByTestId('new-comp')).not.toBeInTheDocument();

    // Add a contribution via act() — useSyncExternalStore picks up the change
    const store = registry.getExtensionPoint(TEST_EP_ID)!;
    act(() => {
      store.register({
        id: 'new-comp',
        plugin: 'plugin-new',
        label: 'new',
        value: () => <div data-testid="new-comp">new</div>,
      });
    });

    expect(screen.getByTestId('new-comp')).toBeInTheDocument();
  });

  // 13.5.30: Mounted renderer rerenders when matching contribution removed
  test('renderer updates when matching contribution is removed', () => {
    const registry = createRegistry();
    setupMultipleEP(registry);
    const store = registry.getExtensionPoint(TEST_EP_ID)!;

    store.register({
      id: 'removable',
      plugin: 'plugin-a',
      label: 'removable',
      value: () => <div data-testid="removable">here</div>,
    });

    renderWithRegistry(
      registry,
      <ExtensionPointRenderer extensionPointId={TEST_EP_ID} />,
    );

    expect(screen.getByTestId('removable')).toBeInTheDocument();

    act(() => {
      store.unregister('removable');
    });

    expect(screen.queryByTestId('removable')).not.toBeInTheDocument();
  });

  // 13.5.31: Mounted renderer rerenders cleanly on plugin reload
  test('renderer updates cleanly when contribution is replaced (plugin reload)', () => {
    const registry = createRegistry();
    setupMultipleEP(registry);
    const store = registry.getExtensionPoint(TEST_EP_ID)!;

    store.register({
      id: 'comp-v1',
      plugin: 'plugin-a',
      label: 'v1',
      value: () => <div data-testid="v1">version 1</div>,
    });

    renderWithRegistry(
      registry,
      <ExtensionPointRenderer extensionPointId={TEST_EP_ID} />,
    );

    expect(screen.getByTestId('v1')).toBeInTheDocument();

    // Simulate reload: remove old, add new
    act(() => {
      store.unregister('comp-v1');
      store.register({
        id: 'comp-v2',
        plugin: 'plugin-a',
        label: 'v2',
        value: () => <div data-testid="v2">version 2</div>,
      });
    });

    expect(screen.queryByTestId('v1')).not.toBeInTheDocument();
    expect(screen.getByTestId('v2')).toBeInTheDocument();
  });
});
