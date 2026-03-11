import { describe, it, expect, vi } from 'vitest';
import { WailsTransport } from './transport';

describe('WailsTransport', () => {
  it('calls the Wails binding with serialized items', () => {
    const mockIngest = vi.fn().mockResolvedValue(undefined);
    const transport = new WailsTransport(mockIngest);
    const items = { type: 1, payload: { message: 'test' }, meta: {} };
    transport.send(items as any);
    expect(mockIngest).toHaveBeenCalledWith(JSON.stringify(items));
  });

  it('does not throw if binding fails', () => {
    const mockIngest = vi.fn().mockRejectedValue(new Error('binding error'));
    const transport = new WailsTransport(mockIngest);
    expect(() => transport.send({ type: 1, payload: {}, meta: {} } as any)).not.toThrow();
  });

  it('has correct name and version', () => {
    const transport = new WailsTransport(vi.fn().mockResolvedValue(undefined));
    expect(transport.name).toBe('wails');
    expect(transport.version).toBe('1.0.0');
  });

  it('isBatched returns false by default', () => {
    const transport = new WailsTransport(vi.fn().mockResolvedValue(undefined));
    expect(transport.isBatched()).toBe(false);
  });
});
