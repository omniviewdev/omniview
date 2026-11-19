import type { KeyboardEvent, RefObject } from 'react';
import type { SearchOptions } from '../../log/lineSearch';
import type { LogViewModel, SearchSnapshot } from '../../log/logViewModel';
import { countText } from '../../log/words';
import { IconButton } from '../IconButton';
import { RovingGroup } from '../RovingGroup';
import { SearchField } from '../SearchField';
import styles from './LogView.module.css';

type FindBarProps = {
  readonly options: SearchOptions;
  readonly onOptionsChange: (options: SearchOptions) => void;
  readonly search: SearchSnapshot;
  readonly model: LogViewModel;
  /** The list: Escape in an empty field goes back to it. */
  readonly listRef: RefObject<HTMLDivElement | null>;
};

/**
 * The find bar of the mock (design 16 FBR1, chapter 12 "Find bar"): ONE group of 4 px gaps: the field with its count lane inside, Match case, Use regular
 * expression, Previous match, Next match. The count is a lane of fixed width inside the field, so a count that appears, changes or goes moves nothing. The
 * toggles and the steps are one roving row, one tab stop. In the field Enter and Shift+Enter step to the next and the previous match, Escape clears the
 * query and, with the field empty, returns to the list.
 */
export function FindBar({ options, onOptionsChange, search, model, listRef }: FindBarProps) {
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.nativeEvent.isComposing || event.target !== event.currentTarget.querySelector('input')) {
      return;
    }

    if (event.key === 'Enter' && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      model.stepMatch(event.shiftKey ? -1 : 1);
    } else if (event.key === 'Escape' && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
      // The field took the Escape that cleared its text; one that arrives here found it empty.
      event.preventDefault();
      listRef.current?.focus();
    }
  };

  return (
    <div className={styles.find} onKeyDown={onKeyDown}>
      <div className={styles.field}>
        <SearchField
          label="Search logs"
          value={options.query}
          onValueChange={(query) => {
            onOptionsChange({ ...options, query });
          }}
          count={countText(search)}
          invalid={search.status === 'invalid'}
        />
      </div>
      <RovingGroup label="Search options" kind="row" gap={4} align="center">
        <IconButton
          icon="case-sensitive"
          label="Match case"
          variant="ghost"
          pressed={options.caseSensitive}
          onClick={() => {
            onOptionsChange({ ...options, caseSensitive: !options.caseSensitive });
          }}
        />
        <IconButton
          icon="regex"
          label="Use regular expression"
          variant="ghost"
          pressed={options.regex}
          onClick={() => {
            onOptionsChange({ ...options, regex: !options.regex });
          }}
        />
        <IconButton
          icon="chevron-up"
          label="Previous match"
          variant="ghost"
          onClick={() => {
            model.stepMatch(-1);
          }}
        />
        <IconButton
          icon="chevron-down"
          label="Next match"
          variant="ghost"
          onClick={() => {
            model.stepMatch(1);
          }}
        />
      </RovingGroup>
    </div>
  );
}
