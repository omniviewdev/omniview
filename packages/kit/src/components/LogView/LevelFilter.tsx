import type { KeyboardEvent } from 'react';
import styles from './LogView.module.css';

/** The mock's quick filter of the level: a minimum rank (`LEVEL_RANK`), each choice in the words of the user, not of a column. */
const CHOICES: ReadonlyArray<{ readonly rank: number; readonly label: string }> = [
  { rank: 0, label: 'All' },
  { rank: 1, label: 'Info+' },
  { rank: 2, label: 'Warn+' },
  { rank: 3, label: 'Error' },
];

type LevelFilterProps = {
  readonly rank: number;
  readonly onChange: (rank: number) => void;
};

/**
 * A segmented radio group (the mock's `H.seg`): one choice is on, it is the one tab stop, and the arrows move to the next or previous choice and choose it
 * (Home and End to the ends). It never wraps.
 */
export function LevelFilter({ rank, onChange }: LevelFilterProps) {
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const at = CHOICES.findIndex((choice) => choice.rank === rank);
    let next = at;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      next = Math.min(CHOICES.length - 1, at + 1);
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      next = Math.max(0, at - 1);
    } else if (event.key === 'Home') {
      next = 0;
    } else if (event.key === 'End') {
      next = CHOICES.length - 1;
    } else {
      return;
    }

    event.preventDefault();
    const choice = CHOICES[next];
    if (choice !== undefined) {
      onChange(choice.rank);
      event.currentTarget.querySelectorAll('button')[next]?.focus();
    }
  };

  return (
    <div className={styles.seg} role="radiogroup" aria-label="Minimum level" onKeyDown={onKeyDown}>
      {CHOICES.map((choice) => (
        <button
          key={choice.rank}
          type="button"
          role="radio"
          aria-checked={choice.rank === rank}
          tabIndex={choice.rank === rank ? 0 : -1}
          onClick={() => {
            onChange(choice.rank);
          }}
        >
          {choice.label}
        </button>
      ))}
    </div>
  );
}
