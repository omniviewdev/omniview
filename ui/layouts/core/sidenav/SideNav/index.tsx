import React from 'react';
import styles from '../SideNav.module.css';

type Props = {
  /** Padding in 8px spacing units. */
  padding?: number;
  /** Fixed width in px. Defaults step up with the window width. */
  width?: number;
  type?: 'inset' | 'bordered' | 'transparent' | 'bordered-inset';
  scrollable?: boolean;
  children: React.ReactNode;
};

/**
 * The side navigation component for the sidenav layout
 */
const SideNav: React.FC<Props> = ({ type = 'inset', scrollable = false, children, width, padding }) => {
  const style: React.CSSProperties & Record<`--${string}`, string> = {
    padding: padding ? `${padding * 8}px` : 0,
    ...(width !== undefined && { '--_nav-width': `${width}px` }),
  };

  return (
    <nav
      className={`Navigation ${styles.Nav}`}
      data-type={type}
      data-scrollable={scrollable || undefined}
      style={style}
    >
      {children}
    </nav>
  );
};

export default SideNav;
