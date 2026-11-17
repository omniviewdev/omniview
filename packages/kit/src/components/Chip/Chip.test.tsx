import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ComponentType, ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { cssRules, declarationsOf } from '../../../scripts/cssRules.ts';
import { Chip, type ChipProps } from './Chip';
import * as examples from './Chip.examples';

const count = (element: ReactElement) => {
  const { container, unmount } = render(element);
  const total = container.querySelectorAll('*').length;
  unmount();
  return total;
};

describe('Chip', () => {
  describe('static', () => {
    it('is one span that holds its text, with no role, no tab stop and no title', () => {
      const { container } = render(<Chip>Running</Chip>);
      const chip = container.firstElementChild as HTMLElement;
      expect(chip.tagName).toBe('SPAN');
      expect(chip.textContent).toBe('Running');
      expect(chip.children).toHaveLength(0);
      expect(chip).toHaveProperty('dataset.ovShape', 'static');
      for (const attribute of ['role', 'tabindex', 'title', 'style', 'aria-pressed', 'aria-label']) {
        expect(chip.hasAttribute(attribute), attribute).toBe(false);
      }

      expect(screen.queryByRole('button')).toBeNull();
    });

    it('puts a count after the text as the bold value of a key and a value, in one text', () => {
      const { container } = render(<Chip count={80}>Running</Chip>);
      const chip = container.firstElementChild as HTMLElement;
      expect(chip.textContent).toBe('Running 80');
      expect(chip.querySelectorAll('b')).toHaveLength(1);
      expect(chip.querySelector('b')?.textContent).toBe('80');
      // The text node before the value keeps its trailing space, as the mock draws it.
      expect(chip.firstChild?.textContent).toBe('Running ');
      expect(chip).toHaveProperty('dataset.ovCounted', 'true');
    });

    it('prints a count of zero: zero is a value, not an absent one', () => {
      const { container } = render(<Chip count={0}>Pending</Chip>);
      expect(container.textContent).toBe('Pending 0');
    });

    it('turns a tone into a data attribute, and none into none', () => {
      const { container, rerender } = render(<Chip>Running</Chip>);
      expect(container.firstElementChild?.hasAttribute('data-ov-tone')).toBe(false);
      for (const tone of ['success', 'warning', 'error', 'info', 'muted'] as const) {
        rerender(<Chip tone={tone}>Running</Chip>);
        expect(container.firstElementChild).toHaveProperty('dataset.ovTone', tone);
      }
    });
  });

  describe('a toggle', () => {
    it('is a native button named by its text, and it says whether it is pressed', () => {
      const { rerender } = render(
        <Chip onClick={() => undefined} pressed={false} count={3}>
          Failed
        </Chip>,
      );
      const chip = screen.getByRole('button', { name: 'Failed 3' });
      expect(chip.tagName).toBe('BUTTON');
      expect(chip.getAttribute('type')).toBe('button');
      expect(chip.getAttribute('aria-pressed')).toBe('false');
      expect(chip).toHaveProperty('dataset.ovShape', 'action');
      for (const attribute of ['title', 'style', 'tabindex', 'disabled', 'aria-disabled', 'aria-label']) {
        expect(chip.hasAttribute(attribute), attribute).toBe(false);
      }

      rerender(
        <Chip onClick={() => undefined} pressed count={3}>
          Failed
        </Chip>,
      );
      expect(screen.getByRole('button', { name: 'Failed 3' }).getAttribute('aria-pressed')).toBe('true');
    });

    it('is a plain action chip, with no pressed state, when it is not told one', () => {
      render(<Chip onClick={() => undefined}>Add filter</Chip>);
      const chip = screen.getByRole('button', { name: 'Add filter' });
      expect(chip.hasAttribute('aria-pressed')).toBe(false);
    });

    it('calls onClick once per click, and never submits a form', () => {
      const onClick = vi.fn();
      const onSubmit = vi.fn((event: { preventDefault: () => void }) => {
        event.preventDefault();
      });
      render(
        <form onSubmit={onSubmit}>
          <Chip onClick={onClick} pressed={false}>
            Failed
          </Chip>
        </form>,
      );
      fireEvent.click(screen.getByRole('button', { name: 'Failed' }));
      expect(onClick).toHaveBeenCalledTimes(1);
      expect(onSubmit).not.toHaveBeenCalled();
    });

    it('keeps its tone and shows the pressed fill over it', () => {
      render(
        <Chip onClick={() => undefined} pressed tone="error">
          Failed
        </Chip>,
      );
      const chip = screen.getByRole('button', { name: 'Failed' });
      expect(chip).toHaveProperty('dataset.ovTone', 'error');
      expect(chip.getAttribute('aria-pressed')).toBe('true');
    });

    it('is a button, a span for its text and a b for its count: three elements', () => {
      const { container } = render(
        <Chip onClick={() => undefined} pressed={false} count={3}>
          Failed
        </Chip>,
      );
      const chip = screen.getByRole('button');
      expect([...chip.querySelectorAll('*')].map((child) => child.tagName)).toEqual(['SPAN', 'B']);
      expect(container.querySelectorAll('*')).toHaveLength(3);
      expect(chip.querySelector('span')?.firstChild?.textContent).toBe('Failed ');
    });
  });

  describe('removable', () => {
    it('is a static text beside a Remove button that is named for what it removes', () => {
      const onRemove = vi.fn();
      const { container } = render(<Chip onRemove={onRemove}>app=cart-api</Chip>);
      const root = container.firstElementChild as HTMLElement;
      expect(root.tagName).toBe('SPAN');
      expect(root).toHaveProperty('dataset.ovShape', 'removable');
      expect(screen.getAllByRole('button')).toHaveLength(1);
      const remove = screen.getByRole('button', { name: 'Remove app=cart-api' });
      expect(remove.getAttribute('type')).toBe('button');
      expect(remove.querySelector('svg')).toHaveProperty('dataset.ovSize', '12');
      expect(root.firstElementChild?.tagName).toBe('SPAN');
      expect(root.firstElementChild?.textContent).toBe('app=cart-api');
      fireEvent.click(remove);
      expect(onRemove).toHaveBeenCalledTimes(1);
    });

    it('names what it removes with the count, as the chip reads', () => {
      render(
        <Chip onRemove={() => undefined} count={3}>
          Failed
        </Chip>,
      );
      expect(screen.getByRole('button', { name: 'Remove Failed 3' })).toBeDefined();
    });

    it('is never itself a button: nothing interactive nests in a non-button', () => {
      const { container } = render(<Chip onRemove={() => undefined}>app=cart-api</Chip>);
      expect(container.firstElementChild?.tagName).not.toBe('BUTTON');
      expect(container.querySelectorAll('button button')).toHaveLength(0);
      expect(container.querySelectorAll('button')).toHaveLength(1);
    });
  });

  it('has the elements it says: one, two with a count, three as a toggle with a count, five when removable', () => {
    expect(count(<Chip>Running</Chip>)).toBe(1);
    expect(count(<Chip count={80}>Running</Chip>)).toBe(2);
    expect(count(<Chip onClick={() => undefined} pressed={false}>All</Chip>)).toBe(2);
    expect(count(<Chip onClick={() => undefined} pressed={false} count={3}>Failed</Chip>)).toBe(3);
    // the chip, its text, the Remove button, its glyph svg and the path of the glyph
    expect(count(<Chip onRemove={() => undefined}>app=cart-api</Chip>)).toBe(5);
  });

  it('passes data-* attributes through and nothing else', () => {
    const Loose = Chip as unknown as ComponentType<Record<string, unknown>>;
    const loose: Record<string, unknown> = { children: 'Running', 'data-testid': 'probe', className: 'restyled', style: { color: 'red' }, id: 'x', title: 'hint', role: 'button', tabIndex: 5 };
    render(<Loose {...loose} />);
    const chip = screen.getByTestId('probe');
    expect(chip.getAttribute('class')).not.toContain('restyled');
    for (const attribute of ['style', 'id', 'title', 'role', 'tabindex']) {
      expect(chip.hasAttribute(attribute), attribute).toBe(false);
    }
  });

  it('has closed props: no className, no style, a text that is text, a tone of the scale, one mode at a time', () => {
    // Types only: these are never rendered.
    const accepted: ChipProps[] = [
      { children: 'Running' },
      { children: 'Running', count: 80, tone: 'success' },
      { children: 'Failed', onClick: () => undefined },
      { children: 'Failed', onClick: () => undefined, pressed: true, count: 3, tone: 'error' },
      { children: 'app=cart-api', onRemove: () => undefined, tone: 'warning' },
      { children: 'Running', tone: undefined, count: undefined },
    ];
    // @ts-expect-error className is not a prop of a kit part
    const withClass: ChipProps = { children: 'Running', className: 'x' };
    // @ts-expect-error style is not a prop of a kit part
    const withStyle: ChipProps = { children: 'Running', style: { color: 'red' } };
    // @ts-expect-error a tone outside the closed set
    const unknownTone: ChipProps = { children: 'Running', tone: 'blue' };
    // @ts-expect-error a chip's text is text, not an element
    const elementText: ChipProps = { children: <b>Running</b> };
    // @ts-expect-error a count is a number
    const textCount: ChipProps = { children: 'Running', count: '80' };
    // @ts-expect-error a chip is a toggle or removable, not both: nothing interactive nests in a non-button
    const both: ChipProps = { children: 'Running', onClick: () => undefined, onRemove: () => undefined };
    // @ts-expect-error pressed needs a command to press
    const pressedAlone: ChipProps = { children: 'Running', pressed: true };
    // @ts-expect-error a title is not a prop: a tooltip is the shared host's
    const withTitle: ChipProps = { children: 'Running', title: 'hint' };
    // @ts-expect-error a chip has a text
    const textless: ChipProps = { count: 3 };
    expect([accepted, withClass, withStyle, unknownTone, elementText, textCount, both, pressedAlone, withTitle, textless]).toHaveLength(10);
  });

  it('writes nothing to the document root: no attribute, no style, no custom property', () => {
    const root = document.documentElement;
    const before = root.getAttribute('style');
    const records: MutationRecord[] = [];
    const observer = new MutationObserver((list) => records.push(...list));
    observer.observe(root, { attributes: true });
    const { rerender } = render(<Chip onClick={() => undefined} pressed={false}>Failed</Chip>);
    fireEvent.click(screen.getByRole('button'));
    rerender(<Chip onRemove={() => undefined}>Failed</Chip>);
    observer.disconnect();
    expect(records).toEqual([]);
    expect(root.getAttribute('style')).toBe(before);
    expect([...root.style].filter((property) => property.startsWith('--'))).toEqual([]);
  });
});

// The a11y matrix of the examples: what a user of assistive technology meets for each state a Chip is shown in.
type Row = {
  /** Buttons in the example: 0 for a static chip, 1 for a toggle, 1 for the Remove button of a removable chip. */
  readonly buttons: 0 | 1;
  /** The text the chip reads as. */
  readonly text: string;
  /** The accessible name of its button. */
  readonly name?: string;
  readonly pressed?: boolean;
  readonly tone?: string;
};
const MATRIX: Readonly<Record<string, Row>> = {
  Static: { buttons: 0, text: 'Running' },
  WithCount: { buttons: 0, text: 'Running 80' },
  ToneSuccess: { buttons: 0, text: 'Passed', tone: 'success' },
  ToneWarning: { buttons: 0, text: 'Attention', tone: 'warning' },
  ToneError: { buttons: 0, text: 'Failed', tone: 'error' },
  ToneInfo: { buttons: 0, text: 'Update available', tone: 'info' },
  ToneMuted: { buttons: 0, text: 'Completed', tone: 'muted' },
  CountWithTone: { buttons: 0, text: 'Passed 80', tone: 'success' },
  CountWithMutedTone: { buttons: 0, text: 'Completed 0', tone: 'muted' },
  Toggle: { buttons: 1, text: 'Failed 3', name: 'Failed 3', pressed: false },
  TogglePressed: { buttons: 1, text: 'Failed 3', name: 'Failed 3', pressed: true },
  ToggleWithoutCount: { buttons: 1, text: 'All', name: 'All', pressed: false },
  ToggleSuccess: { buttons: 1, text: 'Passed 3', name: 'Passed 3', pressed: false, tone: 'success' },
  ToggleWarning: { buttons: 1, text: 'Attention 3', name: 'Attention 3', pressed: false, tone: 'warning' },
  ToggleError: { buttons: 1, text: 'Failed 3', name: 'Failed 3', pressed: false, tone: 'error' },
  ToggleInfo: { buttons: 1, text: 'Update available 3', name: 'Update available 3', pressed: false, tone: 'info' },
  ToggleMuted: { buttons: 1, text: 'Completed 3', name: 'Completed 3', pressed: false, tone: 'muted' },
  TogglePressedWithTone: { buttons: 1, text: 'Passed 3', name: 'Passed 3', pressed: true, tone: 'success' },
  TogglePressedMuted: { buttons: 1, text: 'Completed 3', name: 'Completed 3', pressed: true, tone: 'muted' },
  Removable: { buttons: 1, text: 'app=cart-api', name: 'Remove app=cart-api' },
  RemovableWithTone: { buttons: 1, text: 'app=cart-api', name: 'Remove app=cart-api', tone: 'warning' },
};

describe('Chip examples: the a11y matrix', () => {
  it('has a row for every example, and an example for every row', () => {
    expect(Object.keys(examples).sort()).toEqual(Object.keys(MATRIX).sort());
  });

  for (const [exampleName, row] of Object.entries(MATRIX)) {
    const Example = (examples as Record<string, () => ReactElement>)[exampleName];
    it(`${exampleName}: ${row.buttons === 0 ? 'static text' : row.pressed === undefined ? 'a Remove button' : `a toggle that is ${row.pressed ? '' : 'not '}pressed`}, reading ${row.text}`, () => {
      expect(Example).toBeDefined();
      if (Example === undefined) {
        return;
      }

      const { container } = render(<Example />);
      // exactly the buttons the row says, each with a name from its own markup
      const buttons = screen.queryAllByRole('button');
      expect(buttons).toHaveLength(row.buttons);
      if (row.name !== undefined) {
        const button = screen.getByRole('button', { name: row.name });
        expect(button.getAttribute('type')).toBe('button');
        expect(button.getAttribute('aria-pressed')).toBe(row.pressed === undefined ? null : String(row.pressed));
        // the keyboard reaches it: a native button is in the tab order, and nothing makes it a mouse-only control
        expect(button.tabIndex).toBe(0);
        button.focus();
        expect(document.activeElement).toBe(button);
      }

      // the chip reads as its text, and a tone never stands alone: the state is in the words
      expect(container.textContent?.replace(/\s+/g, ' ').trim()).toBe(row.text);
      const toned = container.querySelector('[data-ov-tone]');
      expect(toned?.getAttribute('data-ov-tone') ?? undefined).toBe(row.tone);
      // glyphs are decorative; no title attribute anywhere
      for (const svg of container.querySelectorAll('svg')) {
        expect(svg.getAttribute('aria-hidden')).toBe('true');
      }

      expect(container.querySelector('[title]')).toBeNull();
    });
  }
});

// The stylesheet, as the rules it holds: jsdom lays nothing out, so what the stylesheet must say is asserted here and what a browser
// paints from it is probed in WebKit and Chromium against the mock (packages/kit/probes).
const css = await readFile(path.join(import.meta.dirname, 'Chip.module.css'), 'utf8');
const rule = (selector: string) => declarationsOf(css, selector);

describe('the Chip stylesheet', () => {
  it('sits in the components layer, and only there', () => {
    expect(css.trimStart()).toMatch(/^@layer ov\.components \{/);
    for (const entry of cssRules(css)) {
      expect(entry.context[0], entry.selector).toBe('@layer ov.components');
    }
  });

  it('is the quiet chip of the mock: 12/16 type, a 6 px side, a 1 px subtle border, the control radius, no fill, muted text, one line, clipped', () => {
    const root = rule('.root');
    expect(root['font-size']).toBe('var(--ov-fs-12)');
    expect(root['line-height']).toBe('var(--ov-lh-16)');
    expect(root['font-weight']).toBe('400');
    expect(root['font-feature-settings']).toBe('var(--ov-font-features)');
    expect(root.padding).toBe('0 var(--ov-spacing-6)');
    expect(root.border).toBe('1px solid var(--_border)');
    expect(root['--_border']).toBe('var(--ov-border-subtle)');
    expect(root['border-radius']).toBe('var(--ov-radius-control)');
    expect(root['--_bg']).toBe('transparent');
    expect(root['background-color']).toBe('var(--_bg)');
    expect(root['--_fg']).toBe('var(--ov-fg-muted)');
    expect(root.color).toBe('var(--_fg)');
    expect(root['white-space']).toBe('nowrap');
    expect(root.overflow).toBe('clip');
    expect(root['min-width']).toBe('0');
    expect(root['max-width']).toBe('100%');
    expect(root['box-sizing']).toBe('border-box');
    expect(root.gap).toBe('var(--ov-spacing-4)');
  });

  it('lays a text-only static chip out as a clipped inline block, which is how its text gets an ellipsis', () => {
    expect(rule('.root[data-ov-shape=\'static\']:not([data-ov-counted=\'true\'])')).toMatchObject({
      display: 'inline-block',
      overflow: 'hidden',
      'text-overflow': 'ellipsis',
      'vertical-align': 'middle',
    });
  });

  it('gives a toggle and a removable chip the control height and the control border, and a toggle its 8 px side, its text at the start and the pointer', () => {
    for (const shape of ['action', 'removable']) {
      const declarations = rule(`.root[data-ov-shape='${shape}']`);
      expect(declarations['min-height'], shape).toBe('var(--ov-control-height)');
      expect(declarations['--_border'], shape).toBe('var(--ov-border-control)');
    }

    expect(rule('.root[data-ov-shape=\'action\']')).toMatchObject({ 'padding-inline': 'var(--ov-spacing-8)', 'justify-content': 'flex-start', cursor: 'pointer' });
    // the Remove button sits at the edge, so the chip keeps no side of its own there
    expect(rule('.root[data-ov-shape=\'removable\']')['padding-inline']).toBe('var(--ov-spacing-8) 0');
  });

  it('paints each tone with the border, fill and text roles of its state', () => {
    const tones = {
      success: ['--ov-success-border', '--ov-success-bg', '--ov-success-fg'],
      warning: ['--ov-warning-border', '--ov-warning-bg', '--ov-warning-fg'],
      error: ['--ov-error-border', '--ov-error-bg', '--ov-error-fg'],
      info: ['--ov-info-border', '--ov-info-bg', '--ov-link'],
      muted: ['--ov-border-subtle', '--ov-bg-inline', '--ov-fg-muted'],
    };
    for (const [tone, [border, fill, text]] of Object.entries(tones)) {
      const declarations = rule(`.root[data-ov-tone='${tone}']`);
      expect(declarations['--_border'], tone).toBe(`var(${border})`);
      expect(declarations['--_bg'], tone).toBe(`var(${fill})`);
      expect(declarations['--_fg'], tone).toBe(`var(${text})`);
    }
  });

  it('paints a pressed toggle with the raised border, the selection fill and the plain text, over its tone', () => {
    const pressed = rule('.root[data-ov-shape=\'action\'][aria-pressed=\'true\']');
    expect(pressed['--_border']).toBe('var(--ov-border-raised)');
    expect(pressed['--_bg']).toBe('var(--ov-selection-inactive)');
    expect(pressed['--_fg']).toBe('var(--ov-fg)');
  });

  it('layers the hover of a toggle as a gradient, so a tone fill stays under it, and changes nothing else', () => {
    expect(rule('.root[data-ov-shape=\'action\']:hover')).toEqual({ 'background-image': 'linear-gradient(var(--ov-hover-row), var(--ov-hover-row))' });
  });

  it('prints a count in the plain text colour and the regular weight', () => {
    expect(rule('.root b')).toMatchObject({ color: 'var(--ov-fg)', 'font-weight': '400' });
  });

  it('lets the text of a toggle or a removable chip give way to the line with an ellipsis, inside the chip', () => {
    expect(rule('.label')).toMatchObject({ 'min-width': '0', overflow: 'hidden', 'text-overflow': 'ellipsis' });
  });

  it('draws a focus ring for the keyboard only: outside the box for the chip, inside it for the Remove button', () => {
    expect(rule('.root:focus-visible')).toEqual({ outline: '2px solid var(--ov-accent)', 'outline-offset': '2px' });
    expect(rule('.remove:focus-visible')['outline-offset']).toBe('-2px');
    expect(css).not.toMatch(/:focus\s*[{,]/);
  });

  it('makes the Remove button a 24 px square in the icon role with the toolbar hover', () => {
    expect(rule('.remove')).toMatchObject({
      flex: '0 0 24px',
      width: '24px',
      'min-width': '24px',
      height: '24px',
      'min-height': '24px',
      padding: '0',
      border: '0',
      background: 'transparent',
      color: 'var(--ov-icon)',
      cursor: 'pointer',
    });
    expect(rule('.remove:hover')).toEqual({ background: 'var(--ov-hover-toolbar)' });
  });

  it('never fades a state with opacity, and takes its paint from tokens', () => {
    expect(css).not.toMatch(/opacity\s*:/);
    for (const token of [
      '--ov-border-subtle', '--ov-border-control', '--ov-border-raised', '--ov-fg', '--ov-fg-muted', '--ov-link', '--ov-icon', '--ov-accent', '--ov-bg-inline',
      '--ov-selection-inactive', '--ov-hover-row', '--ov-hover-toolbar', '--ov-control-height', '--ov-success-fg', '--ov-warning-fg', '--ov-error-fg',
    ]) {
      expect(css, token).toContain(`var(${token})`);
    }
  });
});
