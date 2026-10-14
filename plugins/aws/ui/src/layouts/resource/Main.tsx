import React from 'react';
import styles from './Layout.module.css';

const Main: React.FC<React.HTMLAttributes<HTMLElement>> = ({ className, ...props }) => (
  <main
    {...props}
    className={['Main', styles.main, className].filter(Boolean).join(' ')}
  />
);

export default Main;
