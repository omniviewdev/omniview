import React from 'react';

type Props = React.HTMLAttributes<HTMLDivElement>;

const paneStyle: React.CSSProperties = {
  backgroundColor: 'var(--ov-color-bg-surface)',
  borderRight: '1px solid var(--ov-color-border-default)',
  display: 'initial',
};

/**
 * An optional side pane component for the sidenav layout.
 */
const SidePane: React.FC<Props> = ({ style, ...props }) => (
  <div
    className='Inbox'
    {...props}
    style={{ ...paneStyle, ...style }}
  />
);

export default SidePane;
