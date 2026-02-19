import type { ReactNode } from 'react';
import { Box, Typography } from '@mui/material';

interface ExampleProps {
  title: string;
  description?: string;
  children: ReactNode;
}

/**
 * A single example block rendered on showcase pages. Shows a title, optional
 * description, and a bordered preview area containing the rendered component.
 */
export default function Example({ title, description, children }: ExampleProps) {
  return (
    <Box sx={{ mb: '24px' }}>
      <Typography
        variant="subtitle1"
        sx={{
          fontWeight: 600,
          color: 'var(--ov-fg-base)',
          mb: description ? '4px' : '12px',
        }}
      >
        {title}
      </Typography>

      {description && (
        <Typography
          variant="body2"
          sx={{
            color: 'var(--ov-fg-muted)',
            mb: '12px',
            lineHeight: 1.5,
          }}
        >
          {description}
        </Typography>
      )}

      <Box
        sx={{
          border: '1px solid var(--ov-border-default)',
          borderRadius: '6px',
          padding: '24px',
          bgcolor: 'var(--ov-bg-surface)',
        }}
      >
        {children}
      </Box>
    </Box>
  );
}
