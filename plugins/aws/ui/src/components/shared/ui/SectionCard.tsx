import React from 'react';
import { Card, Separator, Stack, Text } from '@omniviewdev/base-ui';

export type SectionCardProps = {
  /** Header title; ignored when `header` is given. */
  title?: React.ReactNode;
  icon?: React.ReactNode;
  description?: React.ReactNode;
  /** Right-aligned header content (buttons). */
  actions?: React.ReactNode;
  /** Fully custom header content (replaces title/icon/description/actions). */
  header?: React.ReactNode;
  /** Body padding; defaults to `8px 12px`. */
  bodyPadding?: React.CSSProperties['padding'];
  bodyStyle?: React.CSSProperties;
  style?: React.CSSProperties;
  children?: React.ReactNode;
};

const cardStyle: React.CSSProperties = { borderRadius: 4, minWidth: 0, gap: 0 };
const headerStyle: React.CSSProperties = { padding: '8px 10px' };

/**
 * Outlined card with a compact header row, a divider and a body on the surface colour.
 * Replaces the `Card + Box header + Divider + Box body` pattern used throughout the plugin.
 */
export const SectionCard: React.FC<SectionCardProps> = ({
  title,
  icon,
  description,
  actions,
  header,
  bodyPadding = '8px 12px',
  bodyStyle,
  style,
  children,
}) => (
  <Card variant="outline" style={{ ...cardStyle, ...style }}>
    <div style={headerStyle}>
      {header ?? (
        <Stack direction="row" spacing={2} align="center" justify="between">
          <Stack spacing={0}>
            <Stack direction="row" spacing={2} align="center">
              {icon}
              {typeof title === 'string'
                ? <Text weight="semibold" size="sm">{title}</Text>
                : title}
            </Stack>
            {description && (typeof description === 'string'
              ? <Text size="xs" tone="muted">{description}</Text>
              : description)}
          </Stack>
          {actions && (
            <Stack direction="row" spacing={1} align="center">
              {actions}
            </Stack>
          )}
        </Stack>
      )}
    </div>
    <Separator />
    <div
      style={{
        padding: bodyPadding,
        backgroundColor: 'var(--ov-color-bg-surface)',
        ...bodyStyle,
      }}
    >
      {children}
    </div>
  </Card>
);

export default SectionCard;
