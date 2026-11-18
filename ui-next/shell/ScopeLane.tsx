import { Icon, Text } from '@omniviewdev/kit';
import type { ShellScopeFace } from './registration';
import styles from './ScopeLane.module.css';

type ScopeLaneProps = {
  /** Names the lane. Absent while the plugin's frame is on its way: the lane is there, empty, at its rectangle, and no assistive technology reads it. */
  readonly label: string | undefined;
  readonly faces: readonly ShellScopeFace[];
};

/**
 * The scope the page is read in, as text: each face is a glyph, what it is (read, not drawn) and its value. The menus that change a scope
 * arrive with their slice, so a face is not a control and has no chevron. Kit part it should become: ScopeLane.
 */
export function ScopeLane({ label, faces }: ScopeLaneProps) {
  return (
    <div className={styles.lane} role={label === undefined ? undefined : 'group'} aria-label={label} aria-hidden={label === undefined ? 'true' : undefined} data-shell-part="lane">
      {faces.map((face) => (
        <span key={face.label} className={styles.face} data-shell-part="scopeFace">
          <span className={styles.glyph}>
            <Icon name={face.icon} />
          </span>
          <span className={styles.value}>
            <span className={styles.what}>{`${face.label}: `}</span>
            <Text>{face.text}</Text>
          </span>
        </span>
      ))}
    </div>
  );
}
