import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { render, screen, within } from '@testing-library/react';
import type { ComponentType } from 'react';
import { describe, expect, it } from 'vitest';
import { cssRules, declarationsOf } from '../../../scripts/cssRules.ts';
import { WorkspaceToolbar } from './WorkspaceToolbar';
import * as examples from './WorkspaceToolbar.examples';

describe('WorkspaceToolbar', () => {
  it('is one named group: the single command lane of a surface (design 12 TB1)', () => {
    render(
      <WorkspaceToolbar label="Search and filter items">
        <button type="button">One</button>
      </WorkspaceToolbar>,
    );
    const group = screen.getByRole('group', { name: 'Search and filter items' });
    expect(group.tagName).toBe('DIV');
    expect(within(group).getAllByRole('button').map((button) => button.textContent)).toEqual(['One']);
  });

  it('keeps its controls in the order they are given, and the end group after them', () => {
    render(
      <WorkspaceToolbar label="Tools" end={<button type="button">Last</button>}>
        <button type="button">First</button>
        <button type="button">Second</button>
      </WorkspaceToolbar>,
    );
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual(['First', 'Second', 'Last']);
  });

  it('draws the end group only when it has something in it', () => {
    const { container, rerender } = render(
      <WorkspaceToolbar label="Tools">
        <button type="button">First</button>
      </WorkspaceToolbar>,
    );
    expect(container.querySelector('[data-ov-end]')).toBeNull();
    rerender(
      <WorkspaceToolbar label="Tools" end={<button type="button">Last</button>}>
        <button type="button">First</button>
      </WorkspaceToolbar>,
    );
    expect(container.querySelector('[data-ov-end]')?.textContent).toBe('Last');
  });

  it('carries no count text of its own: it holds controls (design 13 N3)', () => {
    const { container } = render(
      <WorkspaceToolbar label="Tools">
        <button type="button">First</button>
      </WorkspaceToolbar>,
    );
    expect(container.textContent).toBe('First');
  });

  it('has no title, no inline style, and passes data attributes through', () => {
    const { container } = render(
      <WorkspaceToolbar label="Tools" data-testid="lane">
        <button type="button">First</button>
      </WorkspaceToolbar>,
    );
    expect(screen.getByTestId('lane')).toBe(container.firstElementChild);
    expect(container.querySelector('[title], [style]')).toBeNull();
  });

  it('is the same few elements: the lane and, when there is an end group, one more', () => {
    const lane = render(
      <WorkspaceToolbar label="Tools">
        <span>a</span>
      </WorkspaceToolbar>,
    );
    expect(lane.container.querySelectorAll('*')).toHaveLength(2);
    lane.unmount();
    const ended = render(
      <WorkspaceToolbar label="Tools" end={<span>b</span>}>
        <span>a</span>
      </WorkspaceToolbar>,
    );
    expect(ended.container.querySelectorAll('*')).toHaveLength(4);
  });
});

describe('the examples of WorkspaceToolbar', () => {
  const entries = Object.entries(examples) as Array<[string, ComponentType]>;

  it('has an example for the search alone and for a lane with filters and an end group', () => {
    expect(entries.map(([name]) => name).sort()).toEqual(['Default', 'WithFiltersAndEnd'].sort());
  });

  for (const [name, Example] of entries) {
    it(`renders ${name} as a named group with a named search box and no title or inline style`, () => {
      const { container } = render(<Example />);
      expect(screen.getByRole('group', { name: /\S/ })).toBeTruthy();
      expect(screen.getByRole('searchbox', { name: 'Search items' })).toBeTruthy();
      expect(container.querySelector('[title], [style]')).toBeNull();
    });
  }
});

const css = await readFile(path.join(import.meta.dirname, 'WorkspaceToolbar.module.css'), 'utf8');
const rule = (selector: string) => declarationsOf(css, selector);

describe('the WorkspaceToolbar stylesheet', () => {
  it('sits in the components layer, and only there', () => {
    expect(css.trimStart()).toMatch(/^@layer ov\.components \{/);
    for (const entry of cssRules(css)) {
      expect(entry.context[0], entry.selector).toBe('@layer ov.components');
    }
  });

  it('is the mock\'s toolbar: one flex lane that wraps, 8 px between its controls, centred on the line, at least the control height', () => {
    expect(rule('.root')).toMatchObject({
      display: 'flex',
      'align-items': 'center',
      'flex-wrap': 'wrap',
      gap: 'var(--ov-spacing-8)',
      'min-width': '0',
      'min-height': 'var(--ov-control-height)',
      'box-sizing': 'border-box',
    });
  });

  it('adds no padding and no margin: the lane under it and the gap to it belong to the view that holds it', () => {
    const root = rule('.root');
    expect(root.padding).toBe('0');
    expect(root.margin).toBe('0');
  });

  it('pushes its end group to the end of the line, and lets that group wrap too', () => {
    expect(rule('.end')).toMatchObject({
      display: 'flex',
      'align-items': 'center',
      'justify-content': 'flex-end',
      'flex-wrap': 'wrap',
      gap: 'var(--ov-spacing-8)',
      'min-width': '0',
      'margin-inline-start': 'auto',
    });
  });
});
