import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { deferred } from '../core/fields/testing';
import { WindowKindScreen } from './WindowKindScreen';
import type { WindowKind } from './windowKind';

// What a window draws is decided by its kind: the shell in a browser at once, and in a native window what the host says it is. A window that cannot be told draws the shell (`windowKind.test.ts`).

afterEach(cleanup);

const settings = <p>the settings window</p>;
const shell = <p>the shell</p>;

describe('in a browser', () => {
  it('draws the shell at once and never asks which window it is', () => {
    const resolve = vi.fn();
    render(
      <WindowKindScreen native={false} resolve={resolve} settings={settings}>
        {shell}
      </WindowKindScreen>,
    );
    expect(screen.getByText('the shell')).toBeInTheDocument();
    expect(resolve).not.toHaveBeenCalled();
  });
});

describe('in a native window', () => {
  it('draws nothing until the host has said which window it is, and asks once', async () => {
    const answer = deferred<WindowKind>();
    const resolve = vi.fn(async () => answer.promise);
    const view = render(
      <WindowKindScreen native resolve={resolve} settings={settings}>
        {shell}
      </WindowKindScreen>,
    );
    expect(view.container).toBeEmptyDOMElement();
    expect(resolve).toHaveBeenCalledTimes(1);
    await act(async () => {
      answer.resolve('other');
    });
    expect(screen.getByText('the shell')).toBeInTheDocument();
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it('draws the Settings window and no shell in a window of kind settings', async () => {
    render(
      <WindowKindScreen native resolve={async () => 'settings'} settings={settings}>
        {shell}
      </WindowKindScreen>,
    );
    expect(await screen.findByText('the settings window')).toBeInTheDocument();
    expect(screen.queryByText('the shell')).toBeNull();
  });
});
