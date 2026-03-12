export interface TelemetryContext {
  traceId?: string;
  spanId?: string;
  component?: string;
  pluginId?: string;
  [key: string]: unknown;
}

export type Fields = Record<string, unknown>;

export function createTelemetryContext(overrides?: Partial<TelemetryContext>): TelemetryContext {
  return { ...overrides };
}

export function emptyContext(): TelemetryContext {
  return {};
}
