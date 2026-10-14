import React from 'react';
import styles from './Layout.module.css';

type Props = {
  /** Padding in 8px spacing units. */
  padding?: number;
  width?: number;
  type?: 'inset' | 'bordered' | 'transparent' | 'bordered-inset';
  scrollable?: boolean;
  children: React.ReactNode;
};

/**
 * The side navigation component for the sidenav layout
 */
const SideNav: React.FC<Props> = ({ type = 'inset', scrollable = false, children, width, padding }) => (
  <nav
    className={`Navigation ${styles.sideNav}`}
    data-type={type}
    data-scrollable={scrollable || undefined}
    style={{
      padding: (padding ?? 0) * 8,
      ...(width !== undefined ? { '--_nav-width': `${width}px` } : {}),
    } as React.CSSProperties}
  >
    {children}
  </nav>
);

export default SideNav;
