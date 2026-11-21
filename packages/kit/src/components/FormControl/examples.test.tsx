import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { examples } from '../../examples';

// An example may not move the focus of the page it is on. The kit probe walks the parts page by Tab from the top of the document, and an example
// that focused something when it mounted, and blurred it again, left the engine's sequential focus starting point in the middle of the page: Tab then
// began at the examples after it (an example that opened the field of Replace did exactly that, and the walk reached the last buttons first).
const PARTS = ['Field', 'TextInput', 'NumberInput', 'Toggle', 'Select', 'SecretInput'] as const;

describe('the form examples', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  for (const part of PARTS) {
    for (const [name, Example] of Object.entries(examples[part] ?? {})) {
      it(`${part}/${name} moves no focus when it mounts`, () => {
        const focus = vi.spyOn(HTMLElement.prototype, 'focus');
        const blur = vi.spyOn(HTMLElement.prototype, 'blur');
        render(<Example />);
        expect(focus).not.toHaveBeenCalled();
        expect(blur).not.toHaveBeenCalled();
      });
    }
  }
});
