import { act, render as renderView, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement, ReactNode } from 'react';
import { useContext } from 'react';
import { RightDrawerContext, jsonToValue, type HostRecord, type RightDrawerContextType } from '@omniviewdev/runtime';
import type * as Runtime from '@omniviewdev/runtime';
import type * as RuntimeApi from '@omniviewdev/runtime/api';
import RightDrawerProvider from '../RightDrawerProvider';
import { getBottomDrawerHeight, setBottomDrawerHeight } from '../BottomDrawer/events';

vi.mock('@omniviewdev/runtime', async () => {
  const actual = await vi.importActual<typeof Runtime>('@omniviewdev/runtime');
  return {
    ...actual,
    useSnackbar: () => ({ showSnackbar: vi.fn() }),
    ConnectionBoundary: ({ pluginID, connectionID, children }: { pluginID: string; connectionID: string; children: ReactNode }): ReactNode => {
      native.boundary(pluginID, connectionID);
      return native.connected ? children : <div>Connection is disconnected</div>;
    },
    withConnectionReady: async (_pluginID: string, _connectionID: string, operation: () => Promise<unknown>) => {
      await native.ready();
      return operation();
    },
  };
});

// Resource editors are a browser-only child boundary, not part of panel sizing.
vi.mock('@/federation/LinkedResourceDrawer', () => ({
  createLinkedResourceDrawer: (...args: unknown[]) => native.drawer(...args),
}));

vi.mock('@/components/displays/RightDrawer', () => ({
  default: () => <div>Resource editor</div>,
}));


const native = vi.hoisted(() => ({ get: vi.fn(), ready: vi.fn(), drawer: vi.fn(), boundary: vi.fn(), connected: true }));
vi.mock('@omniviewdev/runtime/api', async () => {
  const actual = await vi.importActual<typeof RuntimeApi>('@omniviewdev/runtime/api');
  return { ...actual, ResourceClient: { ...actual.ResourceClient, Get: native.get } };
});

let drawer: RightDrawerContextType;
function DrawerProbe() {
  drawer = useContext(RightDrawerContext)!;
  return null;
}

const target = {
  pluginID: 'test',
  targetId: 'host-target',
  route: { connection: 'connection' },
  reference: { address: { provider: 'test', authority: 'host-issued', type: 'pods', id: 'pod', scope: [] } },
  representation: 'json',
};

function render(element: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderView(element, { wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> });
}

function observed(data: unknown): HostRecord {
  return {
    key: 'host-key',
    addressKey: 'host-address',
    targetId: target.targetId,
    route: target.route,
    record: {
      reference: target.reference,
      body: jsonToValue(data),
      representation: { id: 'json', revision: '', schema: { state: 'unknown', validation: 'none', unvalidated: [] } },
      coverage: { kind: 'complete', paths: [] },
    },
  };
}

function pendingRead() {
  const read = Promise.withResolvers<HostRecord | null>();
  const cancel = vi.fn();
  return { ...read, promise: Object.assign(read.promise, { cancel }), cancel };
}

describe('resource drawer request fences', () => {
  beforeEach(() => {
    native.get.mockReset();
    native.ready.mockReset().mockResolvedValue(undefined);
  });

  it('opens only the latest request when reads finish out of order', async () => {
    const first = pendingRead();
    const second = pendingRead();
    native.get.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const view = render(<RightDrawerProvider><DrawerProbe /></RightDrawerProvider>);
    const older = drawer.showResourceSidebar(target);
    const rejected = expect(older).rejects.toMatchObject({ name: 'AbortError' });
    await waitFor(() => {
      expect(native.get).toHaveBeenCalledOnce();
    });
    const newer = drawer.showResourceSidebar({
      ...target,
      reference: { address: { ...target.reference.address, id: 'newer' } },
    });
    await waitFor(() => {
      expect(native.get).toHaveBeenCalledTimes(2);
    });
    expect(first.cancel).toHaveBeenCalledOnce();
    await act(async () => {
      second.resolve(observed({ metadata: { namespace: 'ns', uid: 'new' } }));
      await newer;
    });
    expect(view.container.lastElementChild).toHaveAttribute('data-open', 'true');
    await act(async () => {
      first.resolve(observed({ metadata: { namespace: 'ns', uid: 'old' } }));
      await rejected;
    });
    expect(drawer.isOpen).toBe(true);
    view.unmount();
  });

  it.each(['close', 'abort'] as const)('does not open after %s invalidates a pending read', async (operation) => {
    const read = pendingRead();
    native.get.mockReturnValueOnce(read.promise);
    const view = render(<RightDrawerProvider><DrawerProbe /></RightDrawerProvider>);
    const cancellation = new AbortController();
    const result = drawer.showResourceSidebar({ ...target, signal: cancellation.signal });
    const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' });
    await waitFor(() => {
      expect(native.get).toHaveBeenCalledOnce();
    });
    act(() => {
      if (operation === 'close') {
        drawer.closeDrawer();
      } else {
        cancellation.abort();
      }
    });
    expect(read.cancel).toHaveBeenCalledOnce();
    await act(async () => {
      read.resolve(observed({ metadata: { namespace: 'ns', uid: 'uid' } }));
      await rejected;
    });
    expect(view.container.lastElementChild).not.toHaveAttribute('data-open');
    view.unmount();
  });

  it.each([
    { namespace: 'other', uid: 'expected' },
    { namespace: 'ns', uid: 'replacement' },
  ])('rejects changed resource identity %j', async (metadata) => {
    native.get.mockResolvedValueOnce(observed({ metadata }));
    const view = render(<RightDrawerProvider><DrawerProbe /></RightDrawerProvider>);
    await expect(drawer.showResourceSidebar({
      ...target,
      validateData: (data) => {
        const resource = data as { metadata: { namespace: string; uid: string } };
        return resource.metadata.namespace === 'ns' && resource.metadata.uid === 'expected';
      },
    })).rejects.toThrow(/changed/);
    expect(view.container.lastElementChild).not.toHaveAttribute('data-open');
    view.unmount();
  });

  it('cancels native reads on provider unmount', async () => {
    const read = pendingRead();
    native.get.mockReturnValueOnce(read.promise);
    const view = render(<RightDrawerProvider><DrawerProbe /></RightDrawerProvider>);
    const result = drawer.showResourceSidebar(target);
    const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' });
    await waitFor(() => {
      expect(native.get).toHaveBeenCalledOnce();
    });
    view.unmount();
    expect(read.cancel).toHaveBeenCalledOnce();
    read.resolve(observed({ metadata: { namespace: 'ns', uid: 'uid' } }));
    await rejected;
  });

  it('removes native cancellation listener when read settles', async () => {
    const read = pendingRead();
    native.get.mockReturnValueOnce(read.promise);
    const view = render(<RightDrawerProvider><DrawerProbe /></RightDrawerProvider>);
    const cancellation = new AbortController();
    const remove = vi.spyOn(cancellation.signal, 'removeEventListener');
    const result = drawer.showResourceSidebar({ ...target, signal: cancellation.signal });
    await act(async () => {
      read.resolve(observed({ metadata: { namespace: 'ns', uid: 'uid' } }));
      await result;
    });
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
    cancellation.abort();
    expect(read.cancel).not.toHaveBeenCalled();
    view.unmount();
  });

  it('opens opaque native region data without Kubernetes metadata', async () => {
    const data = { id: 'instance', region: 'eu-west-1' };
    native.get.mockResolvedValueOnce(observed(data));
    const view = render(<RightDrawerProvider><DrawerProbe /></RightDrawerProvider>);
    const validateData = (value: unknown) => {
      const resource = value as { id?: string; region?: string };
      return resource.id === 'instance' && resource.region === 'eu-west-1';
    };

    await act(async () => {
      await drawer.showResourceSidebar({ ...target, validateData });
    });
    expect(drawer.isOpen).toBe(true);
    view.unmount();
  });

  it('rejects missing native records', async () => {
    native.get.mockResolvedValueOnce(null);
    const view = render(<RightDrawerProvider><DrawerProbe /></RightDrawerProvider>);
    await expect(drawer.showResourceSidebar(target)).rejects.toThrow(/no longer available/);
    expect(drawer.isOpen).toBe(false);
    view.unmount();
  });

  it('opens an observed row without another native read', async () => {
    const view = render(<RightDrawerProvider><DrawerProbe /></RightDrawerProvider>);
    await act(async () => {
      await drawer.showResourceSidebar({ ...target, record: observed({ id: 'pod' }) });
    });
    expect(native.get).not.toHaveBeenCalled();
    expect(drawer.isOpen).toBe(true);
    view.unmount();
  });

  it('guards an observed canonical drawer by its actual access route across disconnects', async () => {
    native.connected = true;
    native.drawer.mockReturnValueOnce({});
    native.boundary.mockClear();
    const view = render(<RightDrawerProvider><DrawerProbe /></RightDrawerProvider>);
    await act(async () => {
      await drawer.showResourceSidebar({ ...target, record: observed({ id: 'pod' }) });
    });
    expect(native.boundary).toHaveBeenLastCalledWith('test', 'connection');
    expect(view.getByText('Resource editor')).toBeTruthy();
    expect(native.get).not.toHaveBeenCalled();
    native.connected = false;
    view.rerender(<RightDrawerProvider><DrawerProbe /></RightDrawerProvider>);
    expect(view.getByText('Connection is disconnected')).toBeTruthy();
    expect(view.queryByText('Resource editor')).toBeNull();
    expect(drawer.isOpen).toBe(true);
    native.connected = true;
    view.rerender(<RightDrawerProvider><DrawerProbe /></RightDrawerProvider>);
    expect(view.getByText('Resource editor')).toBeTruthy();
    view.unmount();
  });

  it('rejects a linked record with a changed incarnation', async () => {
    const record = observed({ id: 'pod' });
    native.get.mockResolvedValueOnce({ ...record, record: { ...record.record, reference: { ...target.reference, incarnation: 'replacement' } } });
    const view = render(<RightDrawerProvider><DrawerProbe /></RightDrawerProvider>);
    await expect(drawer.showResourceSidebar({
      ...target,
      reference: { ...target.reference, incarnation: 'expected' },
    })).rejects.toThrow(/identity changed/);
    expect(drawer.isOpen).toBe(false);
    view.unmount();
  });

  it('does not read or open a resource while its connection is unavailable', async () => {
    native.ready.mockRejectedValueOnce(new Error('Connection is not connected.'));
    const view = render(<RightDrawerProvider><DrawerProbe /></RightDrawerProvider>);
    await expect(drawer.showResourceSidebar(target)).rejects.toThrow('Connection is not connected.');
    expect(native.get).not.toHaveBeenCalled();
    expect(drawer.isOpen).toBe(false);
    view.unmount();
  });

  it('does not start a resource read after closing during a connection check', async () => {
    const readiness = Promise.withResolvers<void>();
    native.ready.mockReturnValueOnce(readiness.promise);
    const view = render(<RightDrawerProvider><DrawerProbe /></RightDrawerProvider>);
    const result = drawer.showResourceSidebar(target);
    const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' });
    act(() => {
      drawer.closeDrawer();
    });
    readiness.resolve();
    await rejected;
    expect(native.get).not.toHaveBeenCalled();
    expect(drawer.isOpen).toBe(false);
    view.unmount();
  });
});
describe('RightDrawerProvider', () => {
  it('updates its own layout height without changing the document-wide drawer height', () => {
    const originalHeight = getBottomDrawerHeight();
    const globalHeight = document.documentElement.style.getPropertyValue('--BottomDrawer-height');
    const { container, unmount } = render(<RightDrawerProvider><div>content</div></RightDrawerProvider>);
    try {
      const panel = container.lastElementChild;
      if (!(panel instanceof HTMLElement)) {
        throw new Error('Right drawer panel is unavailable');
      }

      act(() => {
        setBottomDrawerHeight(550); 
      });
      expect(panel.style.getPropertyValue('--BottomDrawer-height')).toBe('550px');
      expect(document.documentElement.style.getPropertyValue('--BottomDrawer-height')).toBe(globalHeight);
      act(() => {
        setBottomDrawerHeight(220); 
      });
      expect(panel.style.getPropertyValue('--BottomDrawer-height')).toBe('220px');
      expect(document.documentElement.style.getPropertyValue('--BottomDrawer-height')).toBe(globalHeight);
    } finally {
      unmount();
      setBottomDrawerHeight(originalHeight);
    }
  });
});
