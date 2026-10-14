import React from 'react';
import styles from './Layout.module.css';

const Root: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className, ...props }) => (
  <div
    {...props}
    className={[styles.root, className].filter(Boolean).join(' ')}
  />
);

export default Root;
