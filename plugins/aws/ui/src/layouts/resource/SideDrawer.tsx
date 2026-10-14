import React from 'react';
import styles from './Layout.module.css';

type Props = React.HTMLAttributes<HTMLDivElement> & {
  onClose: React.MouseEventHandler<HTMLDivElement>;
};

/**
 * An optional side drawer component for the sidenav layout.
 */
const SideDrawer: React.FC<Props> = ({ onClose, className, children, ...props }) => (
  <div
    {...props}
    className={[styles.drawer, className].filter(Boolean).join(' ')}
  >
    <div
      role='button'
      onClick={onClose}
      className={styles.drawerBackdrop}
    />
    <div className={styles.drawerPanel}>
      {children}
    </div>
  </div>
);

export default SideDrawer;
