import { renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useSchemaRegistration } from './useSchemaRegistration';

const mocks = vi.hoisted(() => ({
  schemas: vi.fn(),
  register: vi.fn(),
  unregister: vi.fn(),
}));

vi.mock('@omniviewdev/runtime', () => ({ useEditorSchemas: mocks.schemas }));
vi.mock('./schemaRegistry', () => ({ schemaRegistry: { register: mocks.register, unregister: mocks.unregister } }));

afterEach(() => vi.clearAllMocks());

it('keeps a connection registered until its last consumer unmounts', () => {
  const associations = [{ type: 'pods' }];
  const documents = [{ documentId: 'core' }];
  mocks.schemas.mockReturnValue({ associations, documents, isLoading: false, error: null });
  const first = renderHook(() => useSchemaRegistration({ pluginID: 'provider', connectionID: 'cluster' }));
  const second = renderHook(() => useSchemaRegistration({ pluginID: 'provider', connectionID: 'cluster' }));
  second.unmount();
  expect(mocks.unregister).not.toHaveBeenCalled();
  expect(mocks.register).toHaveBeenLastCalledWith('provider', 'cluster', associations, documents);
  first.unmount();
  expect(mocks.unregister).toHaveBeenCalledOnce();
});
