import { useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Divider from '@mui/material/Divider';
import Collapse from '@mui/material/Collapse';
import MuiIconButton from '@mui/material/IconButton';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import type { SxProps, Theme } from '@mui/material/styles';

export interface FormSectionProps {
  title: string;
  description?: string;
  collapsible?: boolean;
  defaultCollapsed?: boolean;
  children: React.ReactNode;
  sx?: SxProps<Theme>;
}

export default function FormSection({
  title,
  description,
  collapsible = false,
  defaultCollapsed = false,
  children,
  sx,
}: FormSectionProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  return (
    <Box sx={{ mb: 3, ...((typeof sx === 'object' && !Array.isArray(sx)) ? sx : {}) } as SxProps<Theme>}>
      <Divider sx={{ mb: 2 }} />

      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          mb: description ? 0.5 : 1.5,
          cursor: collapsible ? 'pointer' : undefined,
        }}
        onClick={collapsible ? () => setCollapsed((prev) => !prev) : undefined}
      >
        <Typography
          variant="subtitle1"
          sx={{
            fontWeight: 600,
            color: 'var(--ov-fg-base)',
            fontSize: 'var(--ov-text-base)',
          }}
        >
          {title}
        </Typography>
        {collapsible && (
          <MuiIconButton
            size="small"
            sx={{
              transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
              transition: 'transform 200ms',
            }}
          >
            <ExpandMoreIcon fontSize="small" />
          </MuiIconButton>
        )}
      </Box>

      {description && (
        <Typography
          variant="body2"
          sx={{
            color: 'var(--ov-fg-muted)',
            mb: 1.5,
            maxWidth: 600,
            lineHeight: 1.5,
          }}
        >
          {description}
        </Typography>
      )}

      {collapsible ? (
        <Collapse in={!collapsed}>
          {children}
        </Collapse>
      ) : (
        children
      )}
    </Box>
  );
}

FormSection.displayName = 'FormSection';
