import React from 'react';
import { toggleMaximiseOnDoubleClick } from '../toggleMaximise';
import styles from '../Header.module.css';

/**
 * The tabs area in the header. Currently an empty, draggable title-bar region.
 */
const HeaderTabsArea: React.FC = () => (
  <div onClick={toggleMaximiseOnDoubleClick} className={styles.TabsArea} />
);

export default HeaderTabsArea;
