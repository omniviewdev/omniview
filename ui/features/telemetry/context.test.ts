import { describe, it, expect } from 'vitest';
import { createTelemetryContext, emptyContext } from './context';

describe('TelemetryContext', () => {
  it('creates context with provided fields', () => {
    const ctx = createTelemetryContext({ component: 'PluginService', pluginId: 'kubernetes' });
    expect(ctx.component).toBe('PluginService');
    expect(ctx.pluginId).toBe('kubernetes');
  });

  it('createTelemetryContext with no args returns empty context', () => {
    const ctx = createTelemetryContext();
    expect(ctx.component).toBeUndefined();
    expect(ctx.pluginId).toBeUndefined();
    expect(ctx.traceId).toBeUndefined();
  });

  it('emptyContext returns empty object', () => {
    const ctx = emptyContext();
    expect(ctx.component).toBeUndefined();
    expect(ctx.pluginId).toBeUndefined();
  });
});
