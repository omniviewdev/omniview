import { Icon, Text } from '@omniviewdev/kit';
import type { ShellScopeFace } from './registration';
import styles from './ScopeLane.module.css';

type ScopeLaneProps = {
  readonly label: string;
  readonly faces: readonly ShellScopeFace[];
};

/**
 * The scope the page is read in, as text: each face is a glyph, what it is (read, not drawn) and its value. The menus that change a scope
 * arrive with their slice, so a face is not a control and has no chevron. Kit part it should become: ScopeLane.
 */
export function ScopeLane({ label, faces }: ScopeLaneProps) {
  return (
    <div className={styles.lane} role="group" aria-label={label} data-shell-part="lane">
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
