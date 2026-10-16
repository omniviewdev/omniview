import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const defineTheme = vi.fn();
  const setTheme = vi.fn();
  const settings: Record<string, unknown> = {
    'editor.theme': 'application',
  };


  return {
    activeTheme: {
      id: 'void',
      base: 'void',
    },
    settings,
    buildMonacoTheme: vi.fn((base: string, element?: HTMLElement | null) => ({
      base,
      inherit: true,
      rules: [],
      colors: {
        background: element
          ?.closest('[data-editor-theme-scope]')
          ?.getAttribute('data-editor-background'),
      },
    })),
    defineTheme,
    setTheme,
    monaco: {
      editor: {
        defineTheme,
        setTheme,
      },
    },
    setEagerModelSync: vi.fn(),
  };
});

vi.mock('@omniviewdev/base-ui', () => ({
  useTheme: () => ({ activeTheme: mocks.activeTheme }),
}));

vi.mock('@omniviewdev/editors', () => ({
  buildMonacoTheme: (base: string, element?: HTMLElement | null) => (
    mocks.buildMonacoTheme(base, element)
  ),
  OV_MONACO_THEME: 'ov-theme',
}));

vi.mock('@omniviewdev/runtime', () => ({
  useSettings: () => ({ settings: mocks.settings }),
}));

vi.mock('@monaco-editor/react', () => ({
  default: (props: { theme?: string }) => <div data-testid="editor" data-theme={props.theme} />,
  DiffEditor: (props: { theme?: string }) => <div data-testid="diff-editor" data-theme={props.theme} />,
  useMonaco: () => mocks.monaco,
  loader: {
    init: vi.fn().mockResolvedValue({
      languages: {
        typescript: {
          javascriptDefaults: {
            setEagerModelSync: mocks.setEagerModelSync,
          },
        },
      },
    }),
  },
}));

import CodeEditor from './CodeEditor';

function ScopedCodeEditor({ background }: { background: string }) {
  return (
    <div data-editor-theme-scope data-editor-background={background}>
      <CodeEditor language="yaml" value={background} />
    </div>
  );
}

describe('CodeEditor themes', () => {
  beforeEach(() => {
    mocks.activeTheme = { id: 'void', base: 'void' };
    mocks.settings = { 'editor.theme': 'application' };
    vi.clearAllMocks();
  });

  afterEach(cleanup);

  it('rebuilds and reapplies the application Monaco theme when the active theme changes', async () => {
    const view = render(<CodeEditor language="yaml" value="kind: Pod" />);

    await waitFor(() => {
      expect(mocks.buildMonacoTheme).toHaveBeenCalledWith('void', expect.any(HTMLElement));
    });
    expect(mocks.defineTheme).toHaveBeenCalledWith(
      'ov-theme',
      expect.objectContaining({ base: 'void' }),
    );
    expect(mocks.setTheme).toHaveBeenLastCalledWith('ov-theme');
    expect(screen.getByTestId('editor')).toHaveAttribute('data-theme', 'ov-theme');

    mocks.activeTheme = { id: 'plugin:acme/carbon', base: 'carbon' };
    view.rerender(<CodeEditor language="yaml" value="kind: Pod" />);

    await waitFor(() => {
      expect(mocks.buildMonacoTheme).toHaveBeenLastCalledWith('carbon', expect.any(HTMLElement));
    });
    expect(mocks.defineTheme).toHaveBeenLastCalledWith(
      'ov-theme',
      expect.objectContaining({ base: 'carbon' }),
    );
    expect(mocks.setTheme).toHaveBeenLastCalledWith('ov-theme');
  });

  it('rebuilds the application Monaco theme when the selected registration is replaced', async () => {
    mocks.activeTheme = { id: 'plugin:acme/slate', base: 'dark' };
    const view = render(<ScopedCodeEditor background="#102030" />);

    await waitFor(() => {
      expect(mocks.defineTheme).toHaveBeenCalledWith(
        'ov-theme',
        expect.objectContaining({
          colors: { background: '#102030' },
        }),
      );
    });

    mocks.activeTheme = { id: 'plugin:acme/slate', base: 'dark' };
    view.rerender(<ScopedCodeEditor background="#405060" />);

    await waitFor(() => {
      expect(mocks.defineTheme).toHaveBeenLastCalledWith(
        'ov-theme',
        expect.objectContaining({
          colors: { background: '#405060' },
        }),
      );
    });
    expect(screen.getByTestId('editor')).toHaveAttribute('data-theme', 'ov-theme');
  });

  it('keeps an explicit legacy theme selected when the application theme changes', async () => {
    mocks.settings = { 'editor.theme': 'github-dark' };
    const view = render(<CodeEditor language="yaml" value="kind: Pod" />);

    await waitFor(() => {
      expect(mocks.setTheme).toHaveBeenLastCalledWith('github-dark');
    });
    expect(mocks.buildMonacoTheme).not.toHaveBeenCalled();
    expect(screen.getByTestId('editor')).toHaveAttribute('data-theme', 'github-dark');

    mocks.activeTheme = { id: 'light', base: 'light' };
    view.rerender(<CodeEditor language="yaml" value="kind: Pod" />);

    await waitFor(() => {
      expect(mocks.setTheme).toHaveBeenLastCalledWith('github-dark');
    });
    expect(mocks.buildMonacoTheme).not.toHaveBeenCalled();
  });

  it('passes the resolved application theme to the diff editor', () => {
    render(
      <CodeEditor
        language="yaml"
        value="kind: Service"
        original="kind: Pod"
        diff
      />,
    );

    expect(screen.getByTestId('diff-editor')).toHaveAttribute('data-theme', 'ov-theme');
  });
});
