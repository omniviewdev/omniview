import React from 'react';

type Props = React.HTMLAttributes<HTMLDivElement>;

const rootStyle: React.CSSProperties = {
  backgroundColor: 'var(--ov-color-bg-base)',
  display: 'flex',
  flexDirection: 'row',
  flexGrow: 1,
  overflow: 'hidden',
};

/**
 * The root component for the generic sidemenu layout
 */
const Root: React.FC<Props> = ({ style, ...props }) => (
  <div
    {...props}
    style={{ ...rootStyle, ...style }}
  />
);

export default Root;
