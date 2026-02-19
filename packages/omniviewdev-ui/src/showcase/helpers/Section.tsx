import type { ReactNode } from 'react';
import { Box, Typography } from '@mui/material';

interface SectionProps {
  title: string;
  description?: string;
  children: ReactNode;
}

/**
 * A titled section wrapper used on showcase pages to group related examples
 * with a heading, optional description, and consistent vertical spacing.
 */
export default function Section({ title, description, children }: SectionProps) {
  return (
    <Box sx={{ mb: '48px' }}>
      <Typography
        variant="h5"
        sx={{
          color: 'var(--ov-fg-base)',
          fontWeight: 'var(--ov-weight-semibold)',
          mb: description ? '8px' : '16px',
        }}
      >
        {title}
      </Typography>

      {description && (
        <Typography
          variant="body2"
          sx={{
            color: 'var(--ov-fg-muted)',
            mb: '16px',
            maxWidth: 640,
            lineHeight: 1.6,
          }}
        >
          {description}
        </Typography>
      )}

      {children}
    </Box>
  );
}
