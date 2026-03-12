import type { TelemetryContext, Fields } from './context';

export interface LogSink {
  write(level: string, msg: string, fields: Record<string, unknown>): void;
}

export interface Logger {
  trace(ctx: TelemetryContext, msg: string, fields?: Fields): void;
  debug(ctx: TelemetryContext, msg: string, fields?: Fields): void;
  info(ctx: TelemetryContext, msg: string, fields?: Fields): void;
  warn(ctx: TelemetryContext, msg: string, fields?: Fields): void;
  error(ctx: TelemetryContext, msg: string, fields?: Fields): void;
  named(name: string): Logger;
  with(fields: Fields): Logger;
}

export function createLogger(component: string, sink: LogSink, baseFields?: Fields): Logger {
  const enrichAndWrite = (level: string, ctx: TelemetryContext, msg: string, fields?: Fields) => {
    sink.write(level, msg, {
      _component: component,
      ...(ctx.traceId ? { traceId: ctx.traceId } : {}),
      ...(ctx.spanId ? { spanId: ctx.spanId } : {}),
      ...(ctx.pluginId ? { pluginId: ctx.pluginId } : {}),
      ...baseFields,
      ...fields,
    });
  };

  return {
    trace: (ctx, msg, fields) => enrichAndWrite('trace', ctx, msg, fields),
    debug: (ctx, msg, fields) => enrichAndWrite('debug', ctx, msg, fields),
    info: (ctx, msg, fields) => enrichAndWrite('info', ctx, msg, fields),
    warn: (ctx, msg, fields) => enrichAndWrite('warn', ctx, msg, fields),
    error: (ctx, msg, fields) => enrichAndWrite('error', ctx, msg, fields),
    named(name: string): Logger {
      return createLogger(`${component}.${name}`, sink, baseFields);
    },
    with(extraFields: Fields): Logger {
      return createLogger(component, sink, { ...baseFields, ...extraFields });
    },
  };
}
