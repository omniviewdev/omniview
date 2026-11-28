import { describe, expect, it } from 'vitest';
import { isUsLayout, optionIsMeta, readLayout, type LayoutMap } from './layout';

// Whether Option should be Meta, for the setting `macOptionIsMeta` (#697 step 2): `on` and `off` are the person's word, `auto` follows the keyboard layout as Ghostty does (true for US and US International, whose Option
// types little a person misses, and false for every layout that types letters and signs with it: AZERTY, QWERTZ, the Nordic ones). Where the layout cannot be known (a browser without the Keyboard Map API: WebKit's WKWebView,
// Firefox; a call the page may not make) `auto` is false: Option types characters, the conservative answer, because a person on AZERTY who cannot type `@` is worse off than a person on US who must turn Meta on.
// The page only has the keyboard's map of key codes to the characters they type, so a layout is US when the keys that differ between layouts type what the US layout types there.

const US: Readonly<Record<string, string>> = {
  KeyQ: 'q', KeyW: 'w', KeyA: 'a', KeyZ: 'z', KeyM: 'm', Semicolon: ';', Quote: '\'', Backquote: '`', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Minus: '-', Equal: '=', Comma: ',', Period: '.', Slash: '/', Digit2: '2',
};

const mapOf = (keys: Readonly<Record<string, string>>): LayoutMap => ({ get: (code) => keys[code] });

describe('whether a keyboard is a US layout', () => {
  it('is true for the US layout, and for US International, whose base keys are the same', () => {
    expect(isUsLayout(mapOf(US))).toBe(true);
  });

  it.each([
    ['AZERTY', { KeyQ: 'a', KeyA: 'q', KeyW: 'z', KeyZ: 'w', KeyM: ',' }],
    ['QWERTZ', { KeyZ: 'y' }],
    ['the UK layout', { Backslash: '#', Quote: '\'', Digit2: '2', Backquote: '`' }],
    ['Dvorak', { KeyQ: '\'', KeyW: ',', Semicolon: 's' }],
    ['the Nordic layouts', { BracketLeft: 'å', Quote: 'ä', Semicolon: 'ö' }],
  ])('is false for %s', (_, change) => {
    expect(isUsLayout(mapOf({ ...US, ...change }))).toBe(false);
  });

  it('is false for a map that does not say what a key types (a layout the page was not told)', () => {
    expect(isUsLayout(mapOf({}))).toBe(false);
    expect(isUsLayout(mapOf({ KeyQ: 'q' }))).toBe(false);
  });
});

describe('what the page reads of the keyboard', () => {
  it('is the map the browser gives', async () => {
    const navigator = { keyboard: { getLayoutMap: async () => Promise.resolve(mapOf(US)) } };
    expect(await readLayout(navigator)).toBe(true);
    expect(await readLayout({ keyboard: { getLayoutMap: async () => Promise.resolve(mapOf({ ...US, KeyQ: 'a' })) } })).toBe(false);
  });

  it('is nothing known where the API is missing, refuses, or answers what is not a map', async () => {
    expect(await readLayout({})).toBeUndefined();
    expect(await readLayout({ keyboard: {} })).toBeUndefined();
    expect(await readLayout({ keyboard: { getLayoutMap: async () => Promise.reject(new Error('NotAllowedError')) } })).toBeUndefined();
    expect(await readLayout({ keyboard: { getLayoutMap: () => {
      throw new Error('SecurityError'); 
    } } })).toBeUndefined();
    expect(await readLayout({ keyboard: { getLayoutMap: async () => Promise.resolve(null) } })).toBeUndefined();
  });
});

describe('Option as Meta', () => {
  it('is the person\'s word for on and off, whatever the layout', () => {
    expect(optionIsMeta('on', false)).toBe(true);
    expect(optionIsMeta('on', undefined)).toBe(true);
    expect(optionIsMeta('off', true)).toBe(false);
  });

  it('follows a US layout for auto, and is off for another layout and for one nobody can know', () => {
    expect(optionIsMeta('auto', true)).toBe(true);
    expect(optionIsMeta('auto', false)).toBe(false);
    expect(optionIsMeta('auto', undefined)).toBe(false);
  });
});
