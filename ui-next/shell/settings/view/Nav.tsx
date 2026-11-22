import { RovingGroup } from '@omniviewdev/kit';
import type { SettingsPage } from '../model/adapter';
import styles from './Nav.module.css';

type NavProps = {
  readonly pages: readonly SettingsPage[];
  readonly selected: string;
  readonly onSelect: (id: string) => void;
};

/**
 * The pages of Settings (ch16 S124): a named navigation of one group, Core, which is every category the host declares. It is a list of buttons that is one tab stop (the selected page) and moves by the arrows, as the kit's
 * roving group does, and the page on screen is `aria-current`. Not built: the Plugins group (a plugin's own settings need the contract to carry its schema) and the search above it (see the README for each).
 */
export function Nav({ pages, selected, onSelect }: NavProps) {
  return (
    <nav className={styles.nav} aria-label="Settings pages" data-settings-part="nav">
      <div className={styles.group} aria-hidden="true">
        Core
      </div>
      <RovingGroup label="Core" kind="column">
        {pages.map((page) => (
          <button
            key={page.id}
            type="button"
            className={styles.item}
            aria-current={page.id === selected ? 'page' : undefined}
            data-settings-page={page.id}
            onClick={() => {
              onSelect(page.id);
            }}
          >
            {page.title}
          </button>
        ))}
      </RovingGroup>
    </nav>
  );
}
