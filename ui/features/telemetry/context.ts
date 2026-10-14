export type TelemetryContext = {
  [key: string]: unknown;
  traceId?: string;
  spanId?: string;
  component?: string;
  pluginId?: string;
};

export type Fields = Record<string, unknown>;

export function createTelemetryContext(overrides?: Partial<TelemetryContext>): TelemetryContext {
  return { ...overrides };
}

export function emptyContext(): TelemetryContext {
  return {};
}
