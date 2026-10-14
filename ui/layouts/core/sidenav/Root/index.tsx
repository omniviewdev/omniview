import React from 'react';
import styles from '../SideNav.module.css';

/**
 * The root component for the generic sidemenu layout
 */
const Root: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className, ...props }) => (
  <div {...props} className={className ? `${styles.Root} ${className}` : styles.Root} />
);

export default Root;
