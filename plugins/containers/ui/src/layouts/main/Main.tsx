import React from 'react';

type Props = React.HTMLAttributes<HTMLElement>;

/**
 * The main component for the sidenav layout.
 */
const Main: React.FC<Props> = ({ style, className, ...props }) => (
  <main
    className={className ? `Main ${className}` : 'Main'}
    {...props}
    style={{ width: '100%', ...style }}
  />
);

export default Main;
