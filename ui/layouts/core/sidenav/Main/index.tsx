import React from 'react';
import styles from '../SideNav.module.css';

/**
 * The main component for the sidenav layout.
 */
const Main: React.FC<React.HTMLAttributes<HTMLElement>> = ({ className, ...props }) => (
  <main {...props} className={`Main ${styles.Main}${className ? ` ${className}` : ''}`} />
);

export default Main;
