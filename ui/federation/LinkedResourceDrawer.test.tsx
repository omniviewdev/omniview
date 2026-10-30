import {
  forwardRef,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type ReactNode,
} from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { DrawerContext } from '@omniviewdev/runtime';
import type * as Runtime from '@omniviewdev/runtime';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const defineTheme = vi.fn();
  const setTheme = vi.fn();
  const settings: Record<string, unknown> = { 'editor.theme': 'application' };


  return {
    activeTheme: { id: 'void', base: 'void' },
    settings,
    buildMonacoTheme: vi.fn((base: string) => ({ base, inherit: true, rules: [], colors: {} })),
    monaco: {
      editor: { defineTheme, setTheme },
    },
  };
});

vi.mock('@/providers/monaco/useSchemaRegistration', () => ({
  useSchemaRegistration: () => ({ error: null, isLoading: false }),
}));

vi.mock('@omniviewdev/base-ui', () => ({
  useTheme: () => ({ activeTheme: mocks.activeTheme }),
  Stack: forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
    function Stack(props, ref) {
      return <div ref={ref} {...props} />;
    },
  ),
  Button: ({
    startDecorator: _startDecorator,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement> & { startDecorator?: ReactNode }) => <button {...props} />,
}));

vi.mock('@omniviewdev/editors', () => ({
  buildMonacoTheme: (base: string) => mocks.buildMonacoTheme(base),
  OV_MONACO_THEME: 'ov-theme',
}));

vi.mock('@omniviewdev/runtime', async (importOriginal) => {
  const runtime = await importOriginal<typeof Runtime>();
  return { ...runtime, useSettings: () => ({ settings: mocks.settings }) };
});

vi.mock('@monaco-editor/react', () => ({
  default: (props: { theme?: string }) => <div data-testid="linked-editor" data-theme={props.theme} />,
  DiffEditor: (props: { theme?: string }) => <div data-testid="linked-diff-editor" data-theme={props.theme} />,
  useMonaco: () => mocks.monaco,
  loader: {
    init: vi.fn().mockResolvedValue({
      typescript: {
        javascriptDefaults: { setEagerModelSync: vi.fn() },
      },
    }),
  },
}));

import { createLinkedResourceDrawer } from './LinkedResourceDrawer';

const ctx: DrawerContext = {
  data: { apiVersion: 'v1', kind: 'Pod' },
  resource: {
    pluginID: 'test',
    targetId: 'host-target',
    reference: { address: { provider: 'test', authority: 'host-authority', type: 'pods', id: 'pod-1', scope: [] } },
    route: { connection: 'test-connection' },
    representation: 'json',
  },
};

function createDrawer() {
  return createLinkedResourceDrawer('pods', vi.fn(), vi.fn());
}

describe('LinkedResourceDrawer editor themes', () => {
  beforeEach(() => {
    mocks.activeTheme = { id: 'void', base: 'void' };
    mocks.settings = { 'editor.theme': 'application' };
    vi.clearAllMocks();
  });

  afterEach(cleanup);

  it('passes the application theme to overview, editor, and diff views', () => {
    const drawer = createDrawer();
    const overview = render(drawer.views[0].component(ctx));

    expect(screen.getByTestId('linked-editor')).toHaveAttribute('data-theme', 'ov-theme');
    overview.unmount();

    render(drawer.views[1].component(ctx));
    expect(screen.getByTestId('linked-editor')).toHaveAttribute('data-theme', 'ov-theme');

    fireEvent.click(screen.getByRole('button', { name: 'View in Diff Editor' }));
    expect(screen.getByTestId('linked-diff-editor')).toHaveAttribute('data-theme', 'ov-theme');
  });

  it('passes an explicit legacy override to every linked-resource editor', () => {
    mocks.settings = { 'editor.theme': 'brilliance-black' };
    const drawer = createDrawer();
    const overview = render(drawer.views[0].component(ctx));

    expect(screen.getByTestId('linked-editor')).toHaveAttribute('data-theme', 'brilliance-black');
    overview.unmount();

    render(drawer.views[1].component(ctx));
    expect(screen.getByTestId('linked-editor')).toHaveAttribute('data-theme', 'brilliance-black');

    fireEvent.click(screen.getByRole('button', { name: 'View in Diff Editor' }));
    expect(screen.getByTestId('linked-diff-editor')).toHaveAttribute('data-theme', 'brilliance-black');
  });
});
