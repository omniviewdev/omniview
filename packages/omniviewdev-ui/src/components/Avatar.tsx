import MuiAvatar from '@mui/material/Avatar';
import type { SxProps, Theme } from '@mui/material/styles';
import type { ComponentSize, SemanticColor } from '../types';

export interface AvatarProps {
  src?: string;
  name?: string;
  size?: ComponentSize;
  color?: SemanticColor;
  sx?: SxProps<Theme>;
}

const sizeMap: Record<ComponentSize, number> = {
  xs: 24,
  sm: 32,
  md: 40,
  lg: 48,
  xl: 64,
};

const fontSizeMap: Record<ComponentSize, string> = {
  xs: '0.625rem',
  sm: '0.75rem',
  md: '0.875rem',
  lg: '1rem',
  xl: '1.25rem',
};

const colorPalette = [
  '#e57373', '#f06292', '#ba68c8', '#9575cd', '#7986cb',
  '#64b5f6', '#4fc3f7', '#4dd0e1', '#4db6ac', '#81c784',
  '#aed581', '#dce775', '#fff176', '#ffd54f', '#ffb74d',
  '#ff8a65',
];

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
    hash |= 0;
  }
  return Math.abs(hash);
}

function getInitials(name: string): string {
  const words = name.trim().split(/\s+/);
  if (words.length >= 2) {
    return (words[0][0] + words[1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

function getColor(name: string): string {
  return colorPalette[hashString(name) % colorPalette.length];
}

export default function Avatar({
  src,
  name,
  size = 'md',
  sx,
}: AvatarProps) {
  const dim = sizeMap[size];
  const bgColor = name ? getColor(name) : undefined;
  const initials = name ? getInitials(name) : undefined;

  return (
    <MuiAvatar
      src={src}
      alt={name}
      sx={{
        width: dim,
        height: dim,
        fontSize: fontSizeMap[size],
        bgcolor: src ? undefined : bgColor,
        ...sx as Record<string, unknown>,
      }}
    >
      {!src && initials}
    </MuiAvatar>
  );
}

Avatar.displayName = 'Avatar';
