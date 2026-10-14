import React from 'react';

type Props = React.HTMLAttributes<HTMLDivElement> & {
  onClose: React.MouseEventHandler<HTMLDivElement>;
};

const rootStyle: React.CSSProperties = {
  position: 'fixed',
  zIndex: 1200,
  width: '100%',
  height: '100%',
};

const backdropStyle: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  backgroundColor: 'color-mix(in srgb, var(--ov-color-bg-base) 80%, transparent)',
};

const panelStyle: React.CSSProperties = {
  position: 'relative',
  minWidth: 256,
  width: 'max-content',
  height: '100%',
  padding: 16,
  boxShadow: 'var(--ov-primitive-shadow-md)',
  backgroundColor: 'var(--ov-color-bg-surface)',
};

/**
 * An optional side drawer component for the sidenav layout.
 */
const SideDrawer: React.FC<Props> = ({ onClose, style, children, ...props }) => (
  <div
    {...props}
    style={{ ...rootStyle, ...style }}
  >
    <div
      role='button'
      onClick={onClose}
      style={backdropStyle}
    />
    <div style={panelStyle}>
      {children}
    </div>
  </div>
);

export default SideDrawer;
