import React from 'react';
import styles from './Layout.module.css';

/**
 * An optional side pane component for the sidenav layout.
 */
const SidePane: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className, ...props }) => (
  <div
    {...props}
    className={['Inbox', styles.sidePane, className].filter(Boolean).join(' ')}
  />
);

export default SidePane;
