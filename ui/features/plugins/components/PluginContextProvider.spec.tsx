import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { PluginContextProvider } from '@omniviewdev/runtime';

const mockGetPluginMeta = jest.fn();
const mockPluginValues = jest.fn();

beforeEach(() => {
  mockGetPluginMeta.mockReset();
  mockPluginValues.mockReset().mockResolvedValue({});

  // Wails JS bindings call window['go'][...] — set up the stubs.
  (window as any).go = {
    plugin: {
      pluginManager: {
        GetPluginMeta: mockGetPluginMeta,
      },
    },
    settings: {
      Client: {
        PluginValues: mockPluginValues,
      },
    },
  };
});

afterEach(() => {
  delete (window as any).go;
});

describe('PluginContextProvider', () => {
  it('shows loading spinner initially', () => {
    // Never resolve so we stay in loading state
    mockGetPluginMeta.mockReturnValue(new Promise(() => {}));

    const { container } = render(
      <PluginContextProvider pluginId="test-plugin">
        <div>child content</div>
      </PluginContextProvider>,
    );

    // The spinner is a div with inline animation style — verify we have no child content
    expect(screen.queryByText('child content')).not.toBeInTheDocument();
    // And we see the spinning element (keyframes animation)
    expect(container.querySelector('style')).toBeTruthy();
  });

  it('renders children after meta loads successfully', async () => {
    mockGetPluginMeta.mockResolvedValue({
      id: 'test-plugin',
      name: 'Test Plugin',
      version: '1.0.0',
    });

    render(
      <PluginContextProvider pluginId="test-plugin">
        <div>child content</div>
      </PluginContextProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('child content')).toBeInTheDocument();
    });
  });

  it('shows "Plugin failed to load" error with message when GetPluginMeta rejects', async () => {
    mockGetPluginMeta.mockRejectedValue(new Error('connection refused'));

    render(
      <PluginContextProvider pluginId="test-plugin">
        <div>child content</div>
      </PluginContextProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('Plugin failed to load')).toBeInTheDocument();
      expect(screen.getByText('connection refused')).toBeInTheDocument();
    });
    expect(screen.queryByText('child content')).not.toBeInTheDocument();
  });

  it('clicking "Retry" re-fetches metadata', async () => {
    mockGetPluginMeta
      .mockRejectedValueOnce(new Error('first fail'))
      .mockResolvedValueOnce({ id: 'test-plugin', name: 'Test', version: '1.0.0' });

    render(
      <PluginContextProvider pluginId="test-plugin">
        <div>child content</div>
      </PluginContextProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('Plugin failed to load')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Retry'));

    await waitFor(() => {
      expect(screen.getByText('child content')).toBeInTheDocument();
    });
    expect(mockGetPluginMeta).toHaveBeenCalledTimes(2);
  });

  it('does not fetch when pluginId is empty', () => {
    render(
      <PluginContextProvider pluginId="">
        <div>child content</div>
      </PluginContextProvider>,
    );

    expect(mockGetPluginMeta).not.toHaveBeenCalled();
    expect(mockPluginValues).not.toHaveBeenCalled();
  });
});
