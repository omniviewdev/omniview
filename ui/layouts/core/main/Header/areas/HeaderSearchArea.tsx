import React from 'react';
import { Hotkey, SearchInput } from '@omniviewdev/base-ui';
import { LuSearch } from 'react-icons/lu';
import styles from '../Header.module.css';

/**
 * The search area in the header.
 */
const HeaderSearchArea: React.FC = () => (
  <div className={styles.SearchArea}>
    <SearchInput
      size='xs'
      placeholder='Search anything…'
      className={styles.Search}
      startDecorator={<LuSearch className={styles.SearchIcon} />}
      endDecorator={<Hotkey>⌘ K</Hotkey>}
    />
  </div>
);

export default HeaderSearchArea;
