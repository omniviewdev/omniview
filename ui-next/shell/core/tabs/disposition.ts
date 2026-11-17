import type { ModifierEvent, OpenHow } from './types';

/**
 * The disposition a click or a key picks (ch16 S64): none is the caller's plain one (smart, or new for the + menu), Option opens Here, Shift+Command a new tab, Command a
 * background tab (Control elsewhere, and the middle button), Shift a window. Commands run on Enter and ignore the modifiers; that is the caller's rule.
 */
export function dispositionOf(event: ModifierEvent | undefined, options: { readonly platform?: 'mac' | 'other' | undefined; readonly plain?: OpenHow | undefined } = {}): OpenHow {
  const plain = options.plain ?? 'smart';
  if (!event) {
    return plain;
  }

  const command = options.platform === 'mac' ? event.metaKey === true : event.ctrlKey === true;
  if (event.button === 1 || event.type === 'auxclick') {
    return 'background';
  }

  if (command && event.shiftKey === true) {
    return 'new';
  }

  if (command) {
    return 'background';
  }

  if (event.shiftKey === true) {
    return 'window';
  }

  return event.altKey === true ? 'here' : plain;
}
