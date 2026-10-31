import React from 'react';
import { SearchTrigger, Hotkey } from '@omniviewdev/base-ui';
import { NewTabLauncher } from '@/features/workspace/newTab/NewTabLauncher';
import styles from '../Header.module.css';

/**
 * The search area in the header, with the new-tab launcher to its left.
 */
const HeaderSearchArea: React.FC<{ onOpen: () => void }> = ({ onOpen }) => {
  const isMac = typeof navigator !== 'undefined' && /mac/i.test(navigator.userAgent);
  return (
    <div className={styles.SearchArea}>
      <NewTabLauncher />
      <SearchTrigger
        size='sm'
        className={styles.Search}
        placeholder='Search anything…'
        shortcut={<Hotkey size='sm' keys={[isMac ? 'Meta' : 'Control', 'K']} />}
        onClick={onOpen}
        aria-label='Search Omniview'
        aria-keyshortcuts={isMac ? 'Meta+K' : 'Control+K'}
      />
    </div>
  );
};

export default HeaderSearchArea;
