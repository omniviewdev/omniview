import React from 'react';

import styles from './SideNav.module.css';

type Props = {
  padding?: number;
  width?: number;
  type?: 'inset' | 'bordered' | 'transparent' | 'bordered-inset';
  scrollable?: boolean;
  children: React.ReactNode;
};

const typeStyles: Record<NonNullable<Props['type']>, React.CSSProperties> = {
  bordered: {
    backgroundColor: 'var(--ov-color-bg-surface)',
    borderRight: '1px solid var(--ov-color-border-default)',
  },
  inset: {
    backgroundColor: 'transparent',
  },
  transparent: {
    backgroundColor: 'transparent',
    borderRight: '1px solid var(--ov-color-border-default)',
  },
  'bordered-inset': {
    backgroundColor: 'transparent',
    border: '1px solid var(--ov-color-border-default)',
    borderRadius: 'var(--ov-radius-md)',
  },
};

/**
 * The side navigation component for the sidenav layout
 */
const SideNav: React.FC<Props> = ({ type = 'inset', scrollable = false, children, width, padding }) => (
  <nav
    className={scrollable ? `Navigation ${styles.Scrollable}` : 'Navigation'}
    style={{
      minHeight: '100%',
      maxHeight: '100%',
      // padding is expressed in 8px spacing units
      padding: (padding ?? 0.5) * 8,
      minWidth: width ?? 200,
      display: 'initial',
      ...typeStyles[type],
    }}
  >
    {children}
  </nav>
);

export default SideNav;
