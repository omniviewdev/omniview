import React from 'react';
import styles from '../SideNav.module.css';

type Props = React.HTMLAttributes<HTMLDivElement> & {
  onClose: React.MouseEventHandler<HTMLDivElement>;
};

/**
 * An optional side drawer component for the sidenav layout.
 */
const SideDrawer: React.FC<Props> = ({ onClose, className, children, ...props }) => (
  <div {...props} className={className ? `${styles.SideDrawer} ${className}` : styles.SideDrawer}>
    <div role='button' onClick={onClose} className={styles.SideDrawerBackdrop} />
    <div className={styles.SideDrawerPanel}>
      {children}
    </div>
  </div>
);

export default SideDrawer;
