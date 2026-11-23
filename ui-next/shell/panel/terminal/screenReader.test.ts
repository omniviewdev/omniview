import { describe, expect, it, vi } from 'vitest';
import { createScreenReaderChoice, SCREEN_READER_COMMAND, screenReaderSaid, screenReaderWords } from './screenReader';

// The Terminal's screen reader mode (docs/ui-next/status/T1.md, section 16): the one yes or no the whole window holds (every terminal follows it, the session saves it), the name of the palette command that
// changes it, and the words that find it for a person who cannot see the screen: what the terminal's description says while it is off and while it is on, and what is announced when it changes.

describe('the choice', () => {
  it('is off until someone turns it on, and starts from what the window restored', () => {
    expect(createScreenReaderChoice().getSnapshot()).toBe(false);
    expect(createScreenReaderChoice(false).getSnapshot()).toBe(false);
    expect(createScreenReaderChoice(true).getSnapshot()).toBe(true);
  });

  it('is set and toggled, and tells its listeners once for each change and never for a value it already has', () => {
    const choice = createScreenReaderChoice();
    const heard = vi.fn();
    const stop = choice.subscribe(heard);
    choice.set(false);
    expect(heard).not.toHaveBeenCalled();
    choice.set(true);
    expect(choice.getSnapshot()).toBe(true);
    expect(heard).toHaveBeenCalledTimes(1);
    choice.set(true);
    expect(heard).toHaveBeenCalledTimes(1);
    expect(choice.toggle()).toBe(false);
    expect(choice.getSnapshot()).toBe(false);
    expect(heard).toHaveBeenCalledTimes(2);
    expect(choice.toggle()).toBe(true);
    expect(heard).toHaveBeenCalledTimes(3);
    stop();
    choice.toggle();
    expect(heard).toHaveBeenCalledTimes(3);
  });

  it('tells every listener, and one that left while the others were being told is not told', () => {
    const choice = createScreenReaderChoice();
    const calls: string[] = [];
    const stops: Array<() => void> = [];
    stops.push(
      choice.subscribe(() => {
        calls.push('first');
        stops[1]?.();
      }),
      choice.subscribe(() => {
        calls.push('second');
      }),
      choice.subscribe(() => {
        calls.push('third');
      }),
    );
    choice.toggle();
    expect(calls).toEqual(['first', 'third']);
  });
});

describe('the words', () => {
  it('name the palette command exactly: it is what the terminal\'s description sends a person to, and what the palette lists', () => {
    expect(SCREEN_READER_COMMAND).toBe('Terminal: Toggle Screen Reader Mode');
  });

  it('announce a change in one sentence for each state', () => {
    expect(screenReaderSaid(true)).toBe('Terminal screen reader mode on.');
    expect(screenReaderSaid(false)).toBe('Terminal screen reader mode off.');
  });

  it('say, while it is off, that the output is not read aloud until the mode is on, and how to turn it on: leave the terminal, open the palette, run the command', () => {
    expect(screenReaderWords(false, 'mac')).toBe('The output is not read aloud until screen reader mode is on. To turn it on, leave the terminal with F6, open the command palette with ⌘K and run Terminal: Toggle Screen Reader Mode.');
    expect(screenReaderWords(false, 'other')).toBe('The output is not read aloud until screen reader mode is on. To turn it on, leave the terminal with F6, open the command palette with Ctrl+K and run Terminal: Toggle Screen Reader Mode.');
  });

  it('say, while it is on, that it is on and the output is read aloud, and how to turn it off', () => {
    expect(screenReaderWords(true, 'mac')).toBe('Screen reader mode is on: the output is read aloud. To turn it off, leave the terminal with F6, open the command palette with ⌘K and run Terminal: Toggle Screen Reader Mode.');
    expect(screenReaderWords(true, 'other')).toBe('Screen reader mode is on: the output is read aloud. To turn it off, leave the terminal with F6, open the command palette with Ctrl+K and run Terminal: Toggle Screen Reader Mode.');
  });

  it('send a person out of the terminal before the palette, because inside it Command K clears the screen and Control K is the shell\'s', () => {
    for (const on of [false, true]) {
      for (const platform of ['mac', 'other'] as const) {
        const words = screenReaderWords(on, platform);
        expect(words.indexOf('leave the terminal with F6')).toBeGreaterThan(-1);
        expect(words.indexOf('leave the terminal with F6')).toBeLessThan(words.indexOf('command palette'));
        expect(words).toContain(SCREEN_READER_COMMAND);
      }
    }
  });
});
