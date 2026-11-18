import { render } from '@testing-library/react';
import type { ComponentType } from 'react';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import * as examples from './Icon.examples';
import { GLYPHS, type IconName } from './glyphs';
import { Icon, type IconProps } from './Icon';

const names = Object.keys(GLYPHS) as IconName[];

describe('Icon', () => {
  it('is a decorative svg: hidden from assistive technology, no role, no name, no title', () => {
    const { container } = render(<Icon name="refresh" />);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
    expect(svg?.hasAttribute('role')).toBe(false);
    expect(svg?.hasAttribute('aria-label')).toBe(false);
    expect(svg?.hasAttribute('tabindex')).toBe(false);
    expect(svg?.hasAttribute('title')).toBe(false);
    expect(container.querySelector('title')).toBeNull();
    expect(container.textContent).toBe('');
  });

  it('draws at 16 unless it is told 12 or 20, on the artboard of its glyph', () => {
    const { container, rerender } = render(<Icon name="refresh" />);
    expect(container.querySelector('svg')).toHaveProperty('dataset.ovSize', '16');
    expect(container.querySelector('svg')?.getAttribute('viewBox')).toBe('0 0 16 16');
    rerender(<Icon name="box" size={12} />);
    expect(container.querySelector('svg')).toHaveProperty('dataset.ovSize', '12');
    expect(container.querySelector('svg')?.getAttribute('viewBox')).toBe('0 0 24 24');
    rerender(<Icon name="plus" size={20} />);
    expect(container.querySelector('svg')).toHaveProperty('dataset.ovSize', '20');
    expect(container.querySelector('svg')?.getAttribute('viewBox')).toBe('0 0 16 16');
  });

  it('names the glyph it draws, for the stylesheet and for tests', () => {
    const { container } = render(<Icon name="chevron-down" />);
    expect(container.querySelector('svg')).toHaveProperty('dataset.ovGlyph', 'chevron-down');
  });

  it('is exactly one svg and one path per layer, for every glyph', () => {
    for (const name of names) {
      const { container, unmount } = render(<Icon name={name} />);
      expect(container.querySelectorAll('*').length, name).toBe(1 + GLYPHS[name].layers.length);
      expect(container.querySelectorAll('svg').length, name).toBe(1);
      expect(container.querySelectorAll('path').length, name).toBe(GLYPHS[name].layers.length);
      unmount();
    }
  });

  it('paints ink with currentColor, a role through the stylesheet, and a literal colour as itself', () => {
    const ink = render(<Icon name="close" />).container.querySelector('path');
    expect(ink?.getAttribute('stroke')).toBe('currentColor');
    expect(ink?.getAttribute('fill')).toBe('none');
    expect(ink?.hasAttribute('data-ov-stroke')).toBe(false);

    const chevron = render(<Icon name="chevron-down" />).container.querySelector('path');
    expect(chevron?.getAttribute('data-ov-stroke')).toBe('chevron');
    expect(chevron?.hasAttribute('stroke')).toBe(false);
    expect(chevron?.getAttribute('fill')).toBe('none');

    const success = render(<Icon name="status-success" />).container.querySelectorAll('path');
    expect(success[0]?.getAttribute('data-ov-fill')).toBe('success');
    expect(success[0]?.hasAttribute('fill')).toBe(false);
    expect(success[1]?.getAttribute('stroke')).toBe('#FFFFFF');
    expect(success[1]?.getAttribute('stroke-width')).toBe('2');
    expect(success[1]?.getAttribute('stroke-linecap')).toBe('round');
    expect(success[1]?.getAttribute('stroke-linejoin')).toBe('round');

    const play = render(<Icon name="play" />).container.querySelector('path');
    expect(play?.getAttribute('fill')).toBe('#253627');
    expect(play?.getAttribute('data-ov-stroke')).toBe('success');
  });

  it('keeps the even-odd rule of the artwork that needs it', () => {
    const arrow = render(<Icon name="arrow-up" />).container.querySelector('path');
    expect(arrow?.getAttribute('fill-rule')).toBe('evenodd');
    const close = render(<Icon name="close" />).container.querySelector('path');
    expect(close?.hasAttribute('fill-rule')).toBe(false);
  });

  it('passes data-* attributes through and nothing else', () => {
    const Loose = Icon as unknown as ComponentType<Record<string, unknown>>;
    const loose: Record<string, unknown> = { name: 'check', 'data-testid': 'probe', className: 'restyled', style: { color: 'red' }, onClick: () => undefined, id: 'x' };
    const { getByTestId } = render(<Loose {...loose} />);
    const svg = getByTestId('probe');
    expect(svg.getAttribute('class')).not.toContain('restyled');
    expect(svg.hasAttribute('style')).toBe(false);
    expect(svg.hasAttribute('id')).toBe(false);
  });

  it('has closed props: a glyph of the registry, a size of the scale, no className, no style', () => {
    // Types only: a glyph that is not in the registry has nothing to draw, so these are never rendered.
    const accepted: IconProps[] = [{ name: 'refresh' }, { name: 'refresh', size: 12 }, { name: 'refresh', size: 20 }, { name: 'refresh', 'data-testid': 'probe' }];
    // @ts-expect-error a name outside the registry
    const unknownName: IconProps = { name: 'rocket' };
    // @ts-expect-error a size outside the scale
    const unknownSize: IconProps = { name: 'refresh', size: 24 };
    // @ts-expect-error className is not a prop of a kit part
    const withClass: IconProps = { name: 'refresh', className: 'x' };
    // @ts-expect-error style is not a prop of a kit part
    const withStyle: IconProps = { name: 'refresh', style: { color: 'red' } };
    // @ts-expect-error a glyph needs a name
    const nameless: IconProps = {};
    expect([accepted, unknownName, unknownSize, withClass, withStyle, nameless]).toHaveLength(6);
  });

  it('writes nothing to the document root', () => {
    const root = document.documentElement;
    const before = root.getAttribute('style');
    const records: MutationRecord[] = [];
    const observer = new MutationObserver((list) => records.push(...list));
    observer.observe(root, { attributes: true });
    render(<Icon name="refresh" />);
    observer.disconnect();
    expect(records).toEqual([]);
    expect(root.getAttribute('style')).toBe(before);
    expect([...root.style].filter((property) => property.startsWith('--'))).toEqual([]);
  });

  it('has a stylesheet rule for each size, each role a glyph paints with, and no pointer events', async () => {
    const css = await readFile(path.join(import.meta.dirname, 'Icon.module.css'), 'utf8');
    for (const size of ['12', '16', '20']) {
      expect(css).toContain(`[data-ov-size='${size}']`);
    }

    expect(css).toMatch(/pointer-events:\s*none/);
    const used = new Set<string>();
    for (const name of names) {
      for (const layer of GLYPHS[name].layers) {
        for (const [property, paint] of [['fill', layer.fill], ['stroke', layer.stroke]] as const) {
          if (paint !== undefined && paint !== 'ink' && !paint.startsWith('#')) {
            used.add(`${property}:${paint}`);
          }
        }
      }
    }

    expect(used.size).toBeGreaterThan(0);
    for (const entry of used) {
      const [property, role] = entry.split(':');
      expect(css, entry).toContain(`[data-ov-${property}='${role}']`);
    }
  });
});

describe('Icon examples', () => {
  it('render without a warning, and every glyph of the registry is shown in AllGlyphs', () => {
    for (const [name, Example] of Object.entries(examples)) {
      const { container, unmount } = render(<Example />);
      expect(container.querySelectorAll('svg').length, name).toBeGreaterThan(0);
      unmount();
    }

    const { container } = render(<examples.AllGlyphs />);
    const drawn = [...container.querySelectorAll('svg')].map((svg) => svg.getAttribute('data-ov-glyph'));
    expect(new Set(drawn)).toEqual(new Set(names));
  });

  it('keep every icon decorative', () => {
    for (const [name, Example] of Object.entries(examples)) {
      const { container, unmount } = render(<Example />);
      for (const svg of container.querySelectorAll('svg')) {
        expect(svg.getAttribute('aria-hidden'), name).toBe('true');
      }

      unmount();
    }
  });
});
