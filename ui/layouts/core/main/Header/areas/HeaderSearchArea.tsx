import React from 'react';
import { Hotkey } from '@omniviewdev/base-ui';
import { LuSearch } from 'react-icons/lu';
import styles from '../Header.module.css';

/**
 * The search area in the header.
 */
const HeaderSearchArea: React.FC<{ onOpen: () => void }> = ({ onOpen }) => (
  <div className={styles.SearchArea}>
    <button type='button' className={styles.Search} onClick={onOpen} aria-label='Search commands, settings and navigation'>
      <LuSearch className={styles.SearchIcon} aria-hidden='true' />
      <span>Search commands, settings and navigation…</span>
      <Hotkey>Ctrl / ⌘ K</Hotkey>
    </button>
  </div>
);

export default HeaderSearchArea;
