import React from 'react';
import styles from './GradientBackground.module.css';

type Props = {
  children?: React.ReactNode;
};

const GradientBackground: React.FC<Props> = ({ children }) => {
  return (
    <div className={styles.AnimatedBox}>
      {children}
    </div>
  );
};

export default GradientBackground;
