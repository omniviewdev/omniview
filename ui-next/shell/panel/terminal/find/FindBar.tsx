import { IconButton, RovingGroup, SearchField, tip, type IconName } from '@omniviewdev/kit';
import type { KeyboardEvent, Ref } from 'react';
import type { Platform } from '../../../core/chords';
import { chordText } from '../../../palette/words';
import type { FindState } from '../engine';
import styles from './FindBar.module.css';
import { barKeyOf, countText, FIND_FLAGS, type FindFlag, type FindInput } from './findModel';

// The find bar of the Terminal tool (the written spec's FBR1, chapter 12 "Find bar", and the design mock's find bar): ONE group of 4 px gaps floating over the top left of the screen: the field with its count lane inside
// its trailing end, Match case, Use regular expression, Match whole word, Previous match, Next match and Close find. The buttons are one roving row, one Tab stop with the arrows, as the Logs find bar's are; the count
// is a polite live region of fixed width, so a count that comes, changes or goes moves nothing. It holds no state of its own: what it holds, what the engine said and what each control asks are given and asked of
// whoever owns them (`findSession.ts`).

/** The bar's name, and the field's: the landmark and the search box inside it are both "Find in terminal" (chapter 12). */
export const FIND_LABEL = 'Find in terminal';
export const FIND_OPTIONS_LABEL = 'Find options';

/**
 * The switches, by name: the glyph and the name each is drawn with. The kit has no whole-word glyph yet, so that switch borrows `target` (an exact match) until the icons step adds `whole-word`; the name is what a person
 * who cannot see the glyph hears, and it does not change.
 */
const SWITCHES: Readonly<Record<FindFlag, { readonly icon: IconName; readonly label: string }>> = {
  caseSensitive: { icon: 'case-sensitive', label: 'Match case' },
  regex: { icon: 'regex', label: 'Use regular expression' },
  wholeWord: { icon: 'target', label: 'Match whole word' },
};

export type FindBarProps = {
  /** What the field and the switches hold. */
  readonly input: FindInput;
  /** Whether the text parses as the pattern the switches say it is: a pattern that does not marks the field invalid and says so in the lane. */
  readonly valid: boolean;
  /** The search could not be had (the screen's finder failed to load, and no request has got it since): the lane says so. It is not the pattern's fault, so the field is not marked invalid for it. */
  readonly unavailable: boolean;
  /** Where the engine says the find stands for what the bar holds; `undefined` before it has said. */
  readonly result: FindState | undefined;
  /** Writes the keys of the tips (Enter is `↵` on a Mac). */
  readonly platform: Platform;
  readonly onQuery: (query: string) => void;
  readonly onToggle: (flag: FindFlag) => void;
  readonly onStep: (direction: 'next' | 'previous') => void;
  /** The find chord was pressed in the bar: the keyboard goes to the field with its text selected. */
  readonly onFind: () => void;
  readonly onClose: () => void;
  /** The bar's root: whoever opens it finds the field in it to give it the keyboard. */
  readonly ref?: Ref<HTMLDivElement> | undefined;
};

export function FindBar({ input, valid, unavailable, result, platform, onQuery, onToggle, onStep, onFind, onClose, ref }: FindBarProps) {
  // The keys of the bar are taken in the capture phase: the field clears its text on the first Escape and keeps the key, so a handler that waits for the key to come up to it never sees the Escape that should close the bar
  // (the mock closes it without clearing; so does VS Code). What the bar takes it also stops, so that the shell's own Escape, which moves the keyboard to the page, and the window's chords do not see it. The find chord is
  // taken here too: the bar is beside the terminal's screen and not in it, so the screen's key rules never see a key pressed in the bar, and a browser tab would answer the chord with its own find.
  const onKeyDownCapture = (event: KeyboardEvent<HTMLDivElement>) => {
    const action = barKeyOf(event.nativeEvent, platform, event.target instanceof HTMLInputElement);
    if (action === undefined) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    if (action.kind === 'close') {
      onClose();
    } else if (action.kind === 'find') {
      onFind();
    } else {
      onStep(action.direction);
    }
  };

  return (
    <div ref={ref} className={styles.bar} role="search" aria-label={FIND_LABEL} data-shell-part="terminalFind" onKeyDownCapture={onKeyDownCapture}>
      <div className={styles.field}>
        <SearchField label={FIND_LABEL} placeholder="Search output" value={input.query} onValueChange={onQuery} count={countText(result, valid, input.query, unavailable)} invalid={!valid} />
      </div>
      <RovingGroup label={FIND_OPTIONS_LABEL} kind="row" gap={4} align="center">
        {FIND_FLAGS.map((flag) => (
          <IconButton
            key={flag}
            icon={SWITCHES[flag].icon}
            label={SWITCHES[flag].label}
            variant="ghost"
            pressed={input[flag]}
            {...tip(SWITCHES[flag].label)}
            onClick={() => {
              onToggle(flag);
            }}
          />
        ))}
        <IconButton
          icon="chevron-up"
          label="Previous match"
          variant="ghost"
          {...tip(`Previous match\n${chordText('Shift+Enter', platform)}`)}
          onClick={() => {
            onStep('previous');
          }}
        />
        <IconButton
          icon="chevron-down"
          label="Next match"
          variant="ghost"
          {...tip(`Next match\n${chordText('Enter', platform)}`)}
          onClick={() => {
            onStep('next');
          }}
        />
        <IconButton icon="close" label="Close find" variant="ghost" {...tip(`Close find\n${chordText('Escape', platform)}`)} onClick={onClose} />
      </RovingGroup>
    </div>
  );
}
