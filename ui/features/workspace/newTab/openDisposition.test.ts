import { describe, expect, it } from 'vitest';
import { dispositionFor } from './openDisposition';

const keys = (pressed: string) => ({
  shiftKey: pressed.includes('shift'),
  metaKey: pressed.includes('meta'),
  ctrlKey: pressed.includes('ctrl'),
});

describe('dispositionFor', () => {
  it.each([
    ['', false, 'tab'],
    ['shift', false, 'window'],
    ['meta', false, 'background'],
    ['ctrl', false, 'background'],
    ['', true, 'background'],
    ['meta+shift', false, 'tab'],
    ['shift', true, 'tab'],
  ])('modifiers "%s" with middle button %s open a %s', (pressed, middle, expected) => {
    expect(dispositionFor(keys(pressed), middle)).toBe(expected);
  });
});
