import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PodRow } from '../k8s';
import { AgeCell, IdentityCell, ReadyCell, RestartsCell, StatusCell } from './cells';

const NOW = Date.UTC(2026, 10, 17, 12, 0, 0);

function row(over: Partial<PodRow> = {}): PodRow {
  return {
    key: 'k1',
    name: 'cart-api',
    namespace: 'checkout',
    nameTail: 0,
    ready: { ready: 2, total: 2 },
    status: { word: 'Running', role: 'running' },
    restarts: 0,
    createdAt: NOW - 17 * 86_400_000,
    node: 'node-1',
    ip: '10.0.0.1',
    ...over,
  };
}

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('IdentityCell: the tile, the name, and the namespace under it', () => {
  it('draws the tile (decorative), the name and the namespace, each on its own line', () => {
    const { container } = render(<IdentityCell row={row()} />);
    expect(screen.getByTestId('pod-name')).toHaveTextContent('cart-api');
    expect(screen.getByTestId('pod-namespace')).toHaveTextContent('checkout');
    expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });

  it('keeps the end of a generated name whole when it is cut, and reads once and whole', () => {
    const name = 'checkout-payment-gateway-7d8c6f49b-f8q4m';
    const { container } = render(<IdentityCell row={row({ name, nameTail: 11 })} />);
    expect(screen.getByTestId('pod-name')).toHaveTextContent(name);
    expect(screen.getByTestId('pod-name')).toHaveAttribute('data-ov-full', name);
    expect(container.querySelector('[data-ov-full] > :last-child')).toHaveTextContent('7d8c6f49b-f8q4m'.slice(-11));
  });

  it('draws no second line for a row that has no namespace', () => {
    render(<IdentityCell row={row({ namespace: '' })} />);
    expect(screen.queryByTestId('pod-namespace')).toBeNull();
  });

  it('reads the name once and whole: the drawn halves are hidden from assistive technology, whose copy is not cut', () => {
    const name = 'checkout-payment-gateway-7d8c6f49b-f8q4m';
    render(<IdentityCell row={row({ name, nameTail: 11 })} />);
    expect(screen.getByTestId('pod-name').closest('[aria-hidden="true"]')).not.toBeNull();
    expect(screen.getByTestId('pod-name-text')).toHaveTextContent(name);
    expect(screen.getByTestId('pod-name-text').closest('[aria-hidden="true"]')).toBeNull();
  });

  it('is the same few elements for any row: the cell, the tile with its glyph, the lines, the drawn name in its wrapper, the name for assistive technology, and the namespace', () => {
    const { container } = render(<IdentityCell row={row()} />);
    // div.identity > span.tile > svg > path, div.lines > span[aria-hidden] > span (name), span (name) and small (namespace)
    expect(container.querySelectorAll('*').length).toBe(9);
  });
});

describe('StatusCell: the role of the word is the glyph, the word is the name', () => {
  it('draws the word with the glyph of its role, as one status', () => {
    const { container } = render(<StatusCell row={row()} />);
    expect(screen.getByText('Running')).toBeInTheDocument();
    expect(container.querySelector('svg')?.getAttribute('data-ov-glyph')).toBe('play');
  });

  it('draws work that waits to start with the clock, and work under way with the loader', () => {
    const { container, rerender } = render(<StatusCell row={row({ status: { word: 'Pending', role: 'progress' } })} />);
    const queued = container.querySelector('svg')?.getAttribute('data-ov-glyph');
    rerender(<StatusCell row={row({ status: { word: 'ContainerCreating', role: 'progress' } })} />);
    const running = container.querySelector('svg')?.getAttribute('data-ov-glyph');
    expect(queued).not.toBe(running);
    expect(running).toBe('loader-circle');
  });

  it('draws a failure with the error glyph, and the word in the platform\'s own spelling', () => {
    const { container } = render(<StatusCell row={row({ status: { word: 'CrashLoopBackOff', role: 'error' } })} />);
    expect(screen.getByText('CrashLoopBackOff')).toBeInTheDocument();
    expect(container.querySelector('svg')?.getAttribute('data-ov-glyph')).toBe('status-error');
  });

  it('draws a word the table has no role for as plain text: a role is never guessed from a spelling', () => {
    const { container } = render(<StatusCell row={row({ status: { word: 'SomethingNew', role: undefined } })} />);
    expect(container).toHaveTextContent('SomethingNew');
    expect(container.querySelector('svg')).toBeNull();
  });

  it('draws a dash that says why when the object reports no phase', () => {
    render(<StatusCell row={row({ status: undefined })} />);
    expect(screen.getByRole('img', { name: /The Pod reports no phase/ })).toBeInTheDocument();
  });
});

describe('ReadyCell and RestartsCell: counts in the code face, and a dash for what is not known (never a zero)', () => {
  it('draws the ratio of ready containers', () => {
    const { container } = render(<ReadyCell row={row({ ready: { ready: 1, total: 3 } })} />);
    expect(container).toHaveTextContent('1/3');
  });

  it('draws a dash when the object lists no containers', () => {
    render(<ReadyCell row={row({ ready: undefined })} />);
    expect(screen.getByRole('img', { name: /no containers/ })).toBeInTheDocument();
  });

  it('draws the restart count grouped, zero as a count', () => {
    const { container, rerender } = render(<RestartsCell row={row({ restarts: 1204 })} />);
    expect(container).toHaveTextContent('1,204');
    rerender(<RestartsCell row={row({ restarts: 0 })} />);
    expect(container).toHaveTextContent('0');
  });

  it('draws a dash, not zero, when no container has reported a restart count', () => {
    const { container } = render(<RestartsCell row={row({ restarts: undefined })} />);
    expect(screen.getByRole('img', { name: /restart count/ })).toBeInTheDocument();
    expect(container).not.toHaveTextContent('0');
  });
});

describe('AgeCell: one unit, floored, with the instant and the span in the tip', () => {
  it('draws the compact age and the tip', () => {
    const { container } = render(<AgeCell row={row()} />);
    expect(container).toHaveTextContent('17d');
    expect(container.querySelector('[data-ov-tip]')?.getAttribute('data-ov-tip')).toMatch(/^2026-10-31 12:00 UTC · /);
  });

  it('draws a dash when the object has no creation time', () => {
    render(<AgeCell row={row({ createdAt: undefined })} />);
    expect(screen.getByRole('img', { name: /no creation time/ })).toBeInTheDocument();
  });
});
