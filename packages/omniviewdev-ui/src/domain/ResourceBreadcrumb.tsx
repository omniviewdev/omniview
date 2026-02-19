import React from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { LuChevronRight } from 'react-icons/lu';
import type { SxProps, Theme } from '@mui/material/styles';

import type { ComponentSize } from '../types';

export interface BreadcrumbSegment {
  kind: string;
  label: string;
  icon?: React.ReactNode;
}

export interface ResourceBreadcrumbProps {
  segments: BreadcrumbSegment[];
  onNavigate?: (segment: BreadcrumbSegment, index: number) => void;
  size?: ComponentSize;
  sx?: SxProps<Theme>;
}

const fontSizeMap: Record<ComponentSize, string> = {
  xs: 'var(--ov-text-xs)',
  sm: 'var(--ov-text-xs)',
  md: 'var(--ov-text-sm)',
  lg: 'var(--ov-text-sm)',
  xl: 'var(--ov-text-sm)',
};

export default function ResourceBreadcrumb({
  segments,
  onNavigate,
  size = 'sm',
  sx,
}: ResourceBreadcrumbProps) {
  const fontSize = fontSizeMap[size];

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 0.5,
        ...((typeof sx === 'object' && !Array.isArray(sx)) ? sx : {}),
      } as SxProps<Theme>}
    >
      {segments.map((segment, index) => (
        <React.Fragment key={index}>
          {index > 0 && (
            <LuChevronRight size={12} color="var(--ov-fg-faint)" />
          )}
          <Box
            onClick={onNavigate ? () => onNavigate(segment, index) : undefined}
            sx={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 0.5,
              px: 0.5,
              py: 0.125,
              borderRadius: '3px',
              cursor: onNavigate ? 'pointer' : 'default',
              ...(onNavigate && {
                '&:hover': { bgcolor: 'var(--ov-state-hover)' },
              }),
            }}
          >
            {segment.icon && (
              <Box sx={{ display: 'flex', color: 'var(--ov-fg-muted)', flexShrink: 0 }}>
                {segment.icon}
              </Box>
            )}
            <Typography
              sx={{
                fontSize,
                color: index === segments.length - 1 ? 'var(--ov-fg-base)' : 'var(--ov-fg-muted)',
                fontWeight: index === segments.length - 1 ? 500 : 400,
                whiteSpace: 'nowrap',
              }}
            >
              {segment.label}
            </Typography>
          </Box>
        </React.Fragment>
      ))}
    </Box>
  );
}

ResourceBreadcrumb.displayName = 'ResourceBreadcrumb';
