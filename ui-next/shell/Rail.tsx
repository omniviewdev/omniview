import { Icon, RovingGroup, tip } from '@omniviewdev/kit';
import type { ShellRail } from './registration';
import styles from './Rail.module.css';

type RailProps = {
  /** Absent, or with no entries, while the frame is on its way: the track is there, empty, at its rectangle, and no assistive technology reads it. */
  readonly rail: ShellRail | undefined;
  /** An entry was chosen: its id. What it shows is the host's to decide: the host registers it as `current`, and only then is it selected. */
  readonly onSelect: ((id: string) => void) | undefined;
};

/**
 * The rail (ch16 R5, ch12 section 4): a 40 px column of entries, each a 37 x 40 target with a 30 x 30 face and a 20 px glyph, 5 px clear of the window edge and of the sidebar. It is one
 * tab stop in the kit's roving group: the arrows move the focus and select nothing, Enter and Space choose. The entry whose sidebar is shown is `aria-current` and paints the way an open
 * tool does in the mock (the neutral pressed fill; the accent while it, or the region it opens, has the focus). A tip names every entry and opens at once, as a stripe tool's does. F6 lands
 * on the current entry. Kit part it should become: Rail.
 */
export function Rail({ rail, onSelect }: RailProps) {
  if (rail === undefined || rail.entries.length === 0) {
    return <div className={styles.rail} data-shell-part="rail" aria-hidden="true" />;
  }

  const focused = rail.entries.some((entry) => entry.id === rail.current) ? rail.current : rail.entries[0]?.id;
  return (
    <div className={styles.rail} data-shell-part="rail" data-shell-region="rail">
      <RovingGroup label={rail.label} kind="column">
        {rail.entries.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className={styles.entry}
            aria-label={entry.label}
            aria-current={entry.id === rail.current ? 'true' : undefined}
            data-shell-focus={entry.id === focused ? '' : undefined}
            {...tip(entry.problem === undefined ? entry.label : `${entry.label}\n${entry.problem}`, { delay: 0 })}
            onClick={() => {
              onSelect?.(entry.id);
            }}
          >
            <span className={styles.face}>
              <Icon name={entry.icon} size={20} />
            </span>
          </button>
        ))}
      </RovingGroup>
    </div>
  );
}
