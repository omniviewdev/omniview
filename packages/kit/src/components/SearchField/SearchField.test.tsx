import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fireEvent, render, screen } from '@testing-library/react';
import { useState, type ComponentType } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { cssRules, declarationsOf } from '../../../scripts/cssRules.ts';
import { SearchField, type SearchFieldProps } from './SearchField';
import * as examples from './SearchField.examples';

const field = (props: Partial<SearchFieldProps> = {}) => <SearchField label="Search items" value="" onValueChange={() => undefined} {...props} />;

describe('SearchField', () => {
  describe('the field', () => {
    it('is a native search input that is named by its label and shows it as its hint', () => {
      render(field());
      const input = screen.getByRole('searchbox', { name: 'Search items' });
      expect(input.tagName).toBe('INPUT');
      expect(input.getAttribute('type')).toBe('search');
      expect(input.getAttribute('placeholder')).toBe('Search items');
      expect(input.hasAttribute('title')).toBe(false);
    });

    it('can say something other than its name as its hint', () => {
      render(field({ placeholder: 'Name, group or owner' }));
      expect(screen.getByRole('searchbox', { name: 'Search items' }).getAttribute('placeholder')).toBe('Name, group or owner');
    });

    it('turns off the browser\'s own help: no autocomplete, no spelling marks', () => {
      render(field());
      const input = screen.getByRole('searchbox');
      expect(input.getAttribute('autocomplete')).toBe('off');
      expect(input.getAttribute('spellcheck')).toBe('false');
    });

    it('is controlled: it shows the value it is given and reports what is typed, and changes nothing itself', () => {
      const onValueChange = vi.fn();
      const { rerender } = render(field({ value: 'web', onValueChange }));
      const input = screen.getByRole<HTMLInputElement>('searchbox');
      expect(input.value).toBe('web');
      fireEvent.change(input, { target: { value: 'webx' } });
      expect(onValueChange).toHaveBeenCalledWith('webx');
      // Nothing was committed by the caller, so the field still shows what it was given.
      expect(input.value).toBe('web');
      rerender(field({ value: 'webx', onValueChange }));
      expect(input.value).toBe('webx');
    });

    it('reports every keystroke at once: the draft is the caller\'s, and so is the delay before it does any work', () => {
      const onValueChange = vi.fn();
      render(field({ onValueChange }));
      const input = screen.getByRole('searchbox');
      fireEvent.change(input, { target: { value: 'a' } });
      fireEvent.change(input, { target: { value: 'ab' } });
      expect(onValueChange.mock.calls).toEqual([['a'], ['ab']]);
    });

    it('is not marked invalid unless it is told so', () => {
      const { rerender } = render(field());
      expect(screen.getByRole('searchbox').hasAttribute('aria-invalid')).toBe(false);
      rerender(field({ invalid: true }));
      expect(screen.getByRole('searchbox').getAttribute('aria-invalid')).toBe('true');
    });

    it('passes data attributes to the input and nothing else', () => {
      render(field({ 'data-testid': 'search' }));
      expect(screen.getByTestId('search')).toBe(screen.getByRole('searchbox'));
    });
  });

  describe('the clear button', () => {
    it('is not there while the field is empty', () => {
      render(field());
      expect(screen.queryByRole('button')).toBeNull();
    });

    it('appears with text, named "Clear search", and clears the field and keeps the focus in it', () => {
      const onValueChange = vi.fn();
      render(field({ value: 'web', onValueChange }));
      const clear = screen.getByRole('button', { name: 'Clear search' });
      expect(clear.getAttribute('type')).toBe('button');
      fireEvent.click(clear);
      expect(onValueChange).toHaveBeenCalledWith('');
      expect(document.activeElement).toBe(screen.getByRole('searchbox'));
    });

    it('is out of the tab order: Escape is the keyboard\'s way to clear, so the field is one tab stop', () => {
      render(field({ value: 'web' }));
      expect(screen.getByRole('button', { name: 'Clear search' }).getAttribute('tabindex')).toBe('-1');
    });

    it('draws only a decorative glyph', () => {
      render(field({ value: 'web' }));
      const clear = screen.getByRole('button', { name: 'Clear search' });
      expect(clear.querySelectorAll('svg')).toHaveLength(1);
      expect(clear.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    });
  });

  describe('the keyboard', () => {
    it('clears the text on Escape and keeps the key from reaching anything that would act on it', () => {
      const onValueChange = vi.fn();
      const outside = vi.fn();
      render(
        <div onKeyDown={outside}>
          {field({ value: 'web', onValueChange })}
        </div>,
      );
      const input = screen.getByRole('searchbox');
      fireEvent.keyDown(input, { key: 'Escape' });
      expect(onValueChange).toHaveBeenCalledWith('');
      expect(outside).not.toHaveBeenCalled();
    });

    it('lets Escape through when there is nothing to clear: the page decides what it means', () => {
      const onValueChange = vi.fn();
      const outside = vi.fn();
      render(<div onKeyDown={outside}>{field({ value: '', onValueChange })}</div>);
      fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'Escape' });
      expect(onValueChange).not.toHaveBeenCalled();
      expect(outside).toHaveBeenCalledTimes(1);
    });

    it('does not clear while a composition is open, and not on a chord', () => {
      const onValueChange = vi.fn();
      render(field({ value: 'web', onValueChange }));
      const input = screen.getByRole('searchbox');
      fireEvent.keyDown(input, { key: 'Escape', isComposing: true });
      fireEvent.keyDown(input, { key: 'Escape', ctrlKey: true });
      expect(onValueChange).not.toHaveBeenCalled();
    });

    it('submits on Enter, for a caller that waits (the debounce is the caller\'s): the work it was waiting for starts now', () => {
      const onSubmit = vi.fn();
      render(field({ value: 'web', onSubmit }));
      fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'Enter' });
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });

    it('does not submit an Enter that confirms a composition', () => {
      const onSubmit = vi.fn();
      render(field({ value: 'web', onSubmit }));
      fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'Enter', isComposing: true });
      expect(onSubmit).not.toHaveBeenCalled();
    });

    it('works end to end with a caller that owns the draft', () => {
      function Caller() {
        const [draft, setDraft] = useState('');
        return <SearchField label="Search items" value={draft} onValueChange={setDraft} />;
      }

      render(<Caller />);
      const input = screen.getByRole<HTMLInputElement>('searchbox');
      fireEvent.change(input, { target: { value: 'web' } });
      expect(input.value).toBe('web');
      fireEvent.keyDown(input, { key: 'Escape' });
      expect(input.value).toBe('');
      expect(screen.queryByRole('button')).toBeNull();
    });
  });

  describe('the count lane (design PN-07: nothing moves when the count changes or goes)', () => {
    it('is absent unless the field is given a count to show', () => {
      const { container } = render(field());
      expect(container.querySelector('[data-ov-lane]')).toBeNull();
      expect(container.firstElementChild?.hasAttribute('data-ov-counted')).toBe(false);
    });

    it('is a lane inside the field that stays while its text is empty, so the field does not change when the text comes and goes', () => {
      const { container, rerender } = render(field({ count: '' }));
      const lane = container.querySelector('[data-ov-lane]');
      expect(lane).not.toBeNull();
      expect(lane?.textContent).toBe('');
      expect(container.firstElementChild?.getAttribute('data-ov-counted')).toBe('true');
      rerender(field({ count: '3 of 12' }));
      expect(container.querySelector('[data-ov-lane]')?.textContent).toBe('3 of 12');
    });

    it('is a polite live region that describes the field, so a result is heard once and the field keeps its name', () => {
      const { container } = render(field({ count: '3 of 12' }));
      const lane = container.querySelector<HTMLElement>('[data-ov-lane]');
      expect(lane?.getAttribute('aria-live')).toBe('polite');
      expect(lane?.id).not.toBe('');
      expect(screen.getByRole('searchbox').getAttribute('aria-describedby')).toBe(lane?.id);
      expect(screen.getByRole('searchbox', { name: 'Search items' })).toBeTruthy();
    });

    it('does not describe the field when there is no lane', () => {
      render(field());
      expect(screen.getByRole('searchbox').hasAttribute('aria-describedby')).toBe(false);
    });
  });

  it('is the same few elements: the field, its glyph and the input, and a button and a lane only when there is something for them', () => {
    const elements = (props: Partial<SearchFieldProps>) => {
      const { container, unmount } = render(field(props));
      const total = container.querySelectorAll('*').length;
      unmount();
      return total;
    };

    // wrapper, glyph svg, path, input
    expect(elements({})).toBe(4);
    // + button, svg, path
    expect(elements({ value: 'a' })).toBe(7);
    // + lane
    expect(elements({ count: '' })).toBe(5);
    expect(elements({ value: 'a', count: '3 of 12' })).toBe(8);
  });
});

describe('the examples of SearchField', () => {
  const entries = Object.entries(examples) as Array<[string, ComponentType]>;

  it('has an example for the empty field, a typed one, the count lane and the invalid state', () => {
    expect(entries.map(([name]) => name).sort()).toEqual(['Default', 'Invalid', 'WithCount', 'WithText'].sort());
  });

  for (const [name, Example] of entries) {
    it(`renders ${name} with a named search box and no title or inline style`, () => {
      const { container } = render(<Example />);
      expect(screen.getByRole('searchbox').getAttribute('aria-label')).not.toBe('');
      expect(container.querySelector('[title], [style]')).toBeNull();
    });
  }

  it('lets the typed example be cleared with its button', () => {
    render(<examples.WithText />);
    const input = screen.getByRole<HTMLInputElement>('searchbox');
    expect(input.value).not.toBe('');
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(input.value).toBe('');
  });
});

const css = await readFile(path.join(import.meta.dirname, 'SearchField.module.css'), 'utf8');
const rule = (selector: string) => declarationsOf(css, selector);

describe('the SearchField stylesheet', () => {
  it('sits in the components layer, and only there', () => {
    expect(css.trimStart()).toMatch(/^@layer ov\.components \{/);
    for (const entry of cssRules(css)) {
      expect(entry.context[0], entry.selector).toBe('@layer ov.components');
    }
  });

  it('is a flexible box in a toolbar: 220 px to start with, never under 160 px, and its glyph and button sit inside it', () => {
    const root = rule('.root');
    expect(root.position).toBe('relative');
    expect(root.flex).toBe('1 1 220px');
    expect(root['min-width']).toBe('min(160px, 100%)');
  });

  it('is the mock\'s field: the control height, a 1 px control border, the control radius, the inline fill, 13/16 type, the glyph\'s room at the start', () => {
    const input = rule('.input');
    expect(input.display).toBe('block');
    expect(input.width).toBe('100%');
    expect(input['min-height']).toBe('var(--ov-control-height)');
    expect(input['box-sizing']).toBe('border-box');
    expect(input.border).toBe('1px solid var(--_border)');
    expect(input['--_border']).toBe('var(--ov-border-control)');
    expect(input['border-radius']).toBe('var(--ov-radius-control)');
    expect(input['background-color']).toBe('var(--ov-bg-inline)');
    expect(input.color).toBe('var(--ov-fg)');
    expect(input['font-size']).toBe('var(--ov-fs-13)');
    expect(input['line-height']).toBe('var(--ov-lh-16)');
    // 9 px inset + the 16 px glyph + the 4 px gap
    expect(input['padding-inline-start']).toBe('29px');
  });

  it('shows no native search decoration or clear button: the part draws its own', () => {
    expect(rule('.input').appearance).toBe('none');
    expect(rule('.input::-webkit-search-decoration').appearance).toBe('none');
    expect(rule('.input::-webkit-search-cancel-button').appearance).toBe('none');
  });

  it('draws the focus as the mock does: the control border goes to the island colour and a 2 px accent ring sits outside it', () => {
    const focus = rule('.input:focus-visible');
    expect(focus['border-color']).toBe('var(--ov-bg-island)');
    expect(focus.outline).toBe('2px solid var(--ov-accent)');
    expect(focus['outline-offset']).toBe('0');
  });

  it('marks an invalid field with the error control colour, and its ring too', () => {
    expect(rule('.input[aria-invalid=\'true\']')['--_border']).toBe('var(--ov-error-control-inactive)');
    expect(rule('.input[aria-invalid=\'true\']:focus-visible')['outline-color']).toBe('var(--ov-error-control)');
  });

  it('puts the hint in the muted colour at full strength', () => {
    expect(rule('.input::placeholder')).toMatchObject({ color: 'var(--ov-fg-muted)', opacity: '1' });
  });

  it('reserves the end of the field for the button and the lane even when they are not drawn, so the text never reflows', () => {
    // the 24 px button, 2 px from the edge, and 2 px more before the text
    expect(rule('.input')['padding-inline-end']).toBe('28px');
    expect(rule('.root[data-ov-counted=\'true\'] .input')['padding-inline-end']).toBe('calc(28px + 4px + var(--_lane))');
  });

  it('gives the lane a fixed width that grows with the text size, in the muted tabular 12/16 type, on one line, and out of the pointer\'s way', () => {
    expect(rule('.root')['--_lane']).toBe('calc(100px * var(--ov-text-scale))');
    const lane = rule('.lane');
    expect(lane.position).toBe('absolute');
    expect(lane.width).toBe('var(--_lane)');
    expect(lane.height).toBe('var(--ov-lh-16)');
    expect(lane['text-align']).toBe('end');
    expect(lane['font-variant-numeric']).toBe('tabular-nums');
    expect(lane['white-space']).toBe('nowrap');
    expect(lane['text-overflow']).toBe('ellipsis');
    expect(lane['pointer-events']).toBe('none');
    expect(lane['font-size']).toBe('var(--ov-fs-12)');
    expect(lane['line-height']).toBe('var(--ov-lh-16)');
    expect(lane.color).toBe('var(--ov-fg-muted)');
  });

  it('colours the lane as an error while the field is invalid', () => {
    expect(rule('.input[aria-invalid=\'true\'] ~ .lane').color).toBe('var(--ov-error-fg)');
  });

  it('uses only tokens for colour and type, and no hex colour', () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/!important/);
  });
});
