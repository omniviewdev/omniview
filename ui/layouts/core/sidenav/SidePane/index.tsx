import React from 'react';
import styles from '../SideNav.module.css';

/**
 * An optional side pane component for the sidenav layout.
 */
const SidePane: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className, ...props }) => (
  <div {...props} className={`Inbox ${styles.SidePane}${className ? ` ${className}` : ''}`} />
);

export default SidePane;
