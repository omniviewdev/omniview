import { Icon, tip, type IconName } from '@omniviewdev/kit';
import { useId } from 'react';
import { useTabs } from './context';
import { useCanGo } from './hooks';
import styles from './NavButtons.module.css';

type NavButtonProps = {
  readonly name: string;
  readonly icon: IconName;
  /** Why the button does nothing now. A button that cannot act stays focusable with `aria-disabled` and says why (ch16 S6, 14 P2). */
  readonly reason: string | undefined;
  readonly onClick: () => void;
};

function NavButton({ name, icon, reason, onClick }: NavButtonProps) {
  const reasonId = useId();
  return (
    <button
      type="button"
      className={styles.button}
      aria-label={name}
      aria-disabled={reason === undefined ? undefined : 'true'}
      aria-describedby={reason === undefined ? undefined : reasonId}
      {...tip(reason === undefined ? name : `${name}\n${reason}`)}
      onClick={() => {
        if (reason === undefined) {
          onClick();
        }
      }}
    >
      <Icon name={icon} size={20} />
      {reason === undefined ? null : (
        <span id={reasonId} hidden>
          {reason}
        </span>
      )}
    </button>
  );
}

/**
 * Back and Forward (ch16 S6, S50): they walk the history of the tab on screen, never another tab's, and switching tabs does not touch it. 30 px faces with a 20 px glyph, 4 px apart.
 * The mouse's side buttons, the chords and the list of the last ten titles a long press shows are not built. Kit part it should become: NavigationButtons, in the top row.
 */
export function NavButtons() {
  const store = useTabs();
  const canBack = useCanGo(store, 'back');
  const canForward = useCanGo(store, 'forward');
  return (
    <div className={styles.nav} role="group" aria-label="Navigation">
      <NavButton
        name="Back"
        icon="arrow-left"
        reason={canBack ? undefined : 'There is no earlier page in this tab'}
        onClick={() => {
          store.back();
        }}
      />
      <NavButton
        name="Forward"
        icon="arrow-right"
        reason={canForward ? undefined : 'There is no later page in this tab'}
        onClick={() => {
          store.forward();
        }}
      />
    </div>
  );
}
