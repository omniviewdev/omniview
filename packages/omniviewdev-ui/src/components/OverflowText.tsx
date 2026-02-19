import { useRef, useState, useEffect } from 'react';
import Box from '@mui/material/Box';
import MuiTooltip from '@mui/material/Tooltip';
import type { SxProps, Theme } from '@mui/material/styles';

export interface OverflowTextProps {
  children: string;
  maxWidth?: number | string;
  copyOnClick?: boolean;
  sx?: SxProps<Theme>;
}

export default function OverflowText({
  children,
  maxWidth,
  copyOnClick = false,
  sx,
}: OverflowTextProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [isOverflowing, setIsOverflowing] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setIsOverflowing(el.scrollWidth > el.clientWidth);
  }, [children]);

  const handleClick = () => {
    if (copyOnClick) {
      navigator.clipboard.writeText(children).catch(() => {});
    }
  };

  const content = (
    <Box
      ref={ref}
      onClick={handleClick}
      sx={{
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        maxWidth,
        fontSize: '0.8125rem',
        color: 'var(--ov-fg-default)',
        cursor: copyOnClick ? 'pointer' : undefined,
        ...sx as Record<string, unknown>,
      }}
    >
      {children}
    </Box>
  );

  if (isOverflowing) {
    return (
      <MuiTooltip title={children} arrow>
        {content}
      </MuiTooltip>
    );
  }

  return content;
}

OverflowText.displayName = 'OverflowText';
