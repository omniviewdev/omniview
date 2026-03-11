import { describe, it, expect } from 'vitest';
import { createLogger, type LogSink } from './logger';
import { emptyContext } from './context';

describe('Logger', () => {
  const createMockSink = (): LogSink & { calls: Array<{ level: string; msg: string; fields: Record<string, unknown> }> } => {
    const calls: Array<{ level: string; msg: string; fields: Record<string, unknown> }> = [];
    return {
      calls,
      write(level, msg, fields) { calls.push({ level, msg, fields }); },
    };
  };

  it('logs at each level with context enrichment', () => {
    const sink = createMockSink();
    const log = createLogger('TestComponent', sink);
    const ctx = emptyContext();
    log.info(ctx, 'hello', { key: 'value' });
    expect(sink.calls).toHaveLength(1);
    expect(sink.calls[0].level).toBe('info');
    expect(sink.calls[0].msg).toBe('hello');
    expect(sink.calls[0].fields.key).toBe('value');
    expect(sink.calls[0].fields._component).toBe('TestComponent');
  });

  it('named() creates a child logger with dot-separated name', () => {
    const sink = createMockSink();
    const log = createLogger('Parent', sink).named('Child');
    const ctx = emptyContext();
    log.debug(ctx, 'test');
    expect(sink.calls[0].fields._component).toBe('Parent.Child');
  });

  it('with() pre-attaches fields', () => {
    const sink = createMockSink();
    const log = createLogger('Test', sink).with({ env: 'dev' });
    const ctx = emptyContext();
    log.warn(ctx, 'warning');
    expect(sink.calls[0].fields.env).toBe('dev');
  });
});
