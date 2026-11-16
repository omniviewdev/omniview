import { render, screen } from '@testing-library/react';
import type { ComponentType } from 'react';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Text } from './Text';

describe('Text', () => {
  it('renders a span with the body variant and the default tone', () => {
    render(<Text>Plain</Text>);
    const element = screen.getByText('Plain');
    expect(element.tagName).toBe('SPAN');
    expect(element).toHaveProperty('dataset.ovVariant', 'body');
    expect(element).toHaveProperty('dataset.ovTone', 'default');
  });

  it('renders the element it is given, which is structure and not size', () => {
    render(
      <Text as="h1" variant="heading">
        Title
      </Text>,
    );
    const heading = screen.getByRole('heading', { level: 1, name: 'Title' });
    expect(heading).toHaveProperty('dataset.ovVariant', 'heading');
  });

  it('passes data-* attributes through and nothing else', () => {
    // A cast stands for plain JavaScript, which types cannot stop.
    const Loose = Text as unknown as ComponentType<Record<string, unknown>>;
    const loose: Record<string, unknown> = { 'data-testid': 'probe', className: 'restyled', style: { color: 'red' }, onClick: () => undefined, id: 'x' };
    render(<Loose {...loose}>Closed</Loose>);
    const element = screen.getByTestId('probe');
    expect(element.getAttribute('class')).not.toContain('restyled');
    expect(element.hasAttribute('style')).toBe(false);
    expect(element.hasAttribute('id')).toBe(false);
  });

  it('has closed props: no className, no style, no value outside the scale', () => {
    // @ts-expect-error className is not a prop of a kit part
    render(<Text className="x">a</Text>);
    // @ts-expect-error style is not a prop of a kit part
    render(<Text style={{ color: 'red' }}>b</Text>);
    // @ts-expect-error a variant outside the closed type scale
    render(<Text variant="huge">c</Text>);
    // @ts-expect-error a tone outside the closed foreground roles
    render(<Text tone="red">d</Text>);
    // @ts-expect-error an element outside the closed set
    render(<Text as="marquee">e</Text>);
    expect(screen.getAllByText(/^[a-e]$/)).toHaveLength(5);
  });

  it('has a rule in its stylesheet for every variant and tone it accepts', async () => {
    const css = await readFile(path.join(import.meta.dirname, 'Text.module.css'), 'utf8');
    for (const variant of ['heading', 'title', 'body', 'caption']) {
      expect(css).toContain(`[data-ov-variant='${variant}']`);
    }

    for (const tone of ['default', 'muted']) {
      expect(css).toContain(`[data-ov-tone='${tone}']`);
    }
  });
});
