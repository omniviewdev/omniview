import React from 'react';
import { Text } from '@omniviewdev/base-ui';

export type LabeledRowProps = {
  label: React.ReactNode;
  children?: React.ReactNode;
  /** Columns (out of 12) taken by the label. Default 4. */
  labelSpan?: number;
  alignCenter?: boolean;
  style?: React.CSSProperties;
};

/** Two-column label/value row (replaces MUI `Grid container` with `size={4}` / `size={8}`). */
export const LabeledRow: React.FC<LabeledRowProps> = ({
  label,
  children,
  labelSpan = 4,
  alignCenter,
  style,
}) => (
  <div
    style={{
      display: 'grid',
      gridTemplateColumns: `minmax(0, ${labelSpan}fr) minmax(0, ${12 - labelSpan}fr)`,
      alignItems: alignCenter ? 'center' : undefined,
      ...style,
    }}
  >
    <div>
      {typeof label === 'string' ? <Text size="xs" tone="muted">{label}</Text> : label}
    </div>
    <div>{children}</div>
  </div>
);

/** Bold value text used next to a LabeledRow label. */
export const ValueText: React.FC<{ children?: React.ReactNode; fontSize?: number; style?: React.CSSProperties }> = ({
  children,
  fontSize = 12,
  style,
}) => (
  <Text size="xs" style={{ fontWeight: 600, fontSize, wordBreak: 'break-all', ...style }}>
    {children}
  </Text>
);

export default LabeledRow;
