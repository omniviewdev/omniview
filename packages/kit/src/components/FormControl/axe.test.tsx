import { render } from '@testing-library/react';
import axe from 'axe-core';
import { describe, expect, it } from 'vitest';
import { examples } from '../../examples';

// Every example of the six form parts, in every state of the field model, under axe-core in jsdom. jsdom has no layout, so colour contrast and
// the rules that need it are off here; the form probe runs axe again in WebKit and Chromium, in two themes, where they are judged.
const PARTS = ['Field', 'TextInput', 'NumberInput', 'Toggle', 'Select', 'SecretInput'] as const;

describe('the form parts, by axe-core', () => {
  for (const part of PARTS) {
    for (const [name, Example] of Object.entries(examples[part] ?? {})) {
      it(`${part}/${name} has no violation`, async () => {
        const { container } = render(<Example />);
        const result = await axe.run(container, { rules: { 'color-contrast': { enabled: false }, region: { enabled: false } } });
        expect(result.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).join(', ')}`)).toEqual([]);
      });
    }
  }
});
