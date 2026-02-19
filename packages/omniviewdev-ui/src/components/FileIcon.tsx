import Box from '@mui/material/Box';
import { LuFile, LuFileCode, LuFileText, LuFileImage, LuBraces } from 'react-icons/lu';
import { SiGo, SiTypescript, SiJavascript, SiPython, SiRust, SiDocker } from 'react-icons/si';
import type { SxProps, Theme } from '@mui/material/styles';

import type { ComponentSize } from '../types';

export interface FileIconProps {
  filename: string;
  size?: ComponentSize;
  sx?: SxProps<Theme>;
}

const iconSizeMap: Record<ComponentSize, number> = {
  xs: 12,
  sm: 14,
  md: 16,
  lg: 20,
  xl: 24,
};

interface IconDef {
  icon: React.ComponentType<{ size?: number }>;
  color: string;
}

function getIconForExt(ext: string, basename: string): IconDef {
  // Dockerfile special case
  if (basename.toLowerCase().startsWith('dockerfile')) {
    return { icon: SiDocker, color: 'var(--ov-info-default)' };
  }

  switch (ext) {
    case '.go':
      return { icon: SiGo, color: '#00ADD8' };
    case '.ts':
    case '.tsx':
      return { icon: SiTypescript, color: '#3178C6' };
    case '.js':
    case '.jsx':
    case '.mjs':
    case '.cjs':
      return { icon: SiJavascript, color: '#F7DF1E' };
    case '.py':
      return { icon: SiPython, color: '#3776AB' };
    case '.rs':
      return { icon: SiRust, color: '#DEA584' };
    case '.yaml':
    case '.yml':
      return { icon: LuFileCode, color: 'var(--ov-info-default)' };
    case '.json':
      return { icon: LuBraces, color: '#F5C518' };
    case '.md':
    case '.mdx':
    case '.txt':
    case '.log':
      return { icon: LuFileText, color: 'var(--ov-fg-muted)' };
    case '.html':
    case '.htm':
    case '.xml':
    case '.svg':
      return { icon: LuFileCode, color: '#E44D26' };
    case '.css':
    case '.scss':
    case '.less':
      return { icon: LuFileCode, color: '#264DE4' };
    case '.png':
    case '.jpg':
    case '.jpeg':
    case '.gif':
    case '.webp':
    case '.ico':
      return { icon: LuFileImage, color: 'var(--ov-success-default)' };
    case '.toml':
    case '.ini':
    case '.env':
    case '.cfg':
      return { icon: LuFileCode, color: 'var(--ov-fg-muted)' };
    case '.sh':
    case '.bash':
    case '.zsh':
      return { icon: LuFileCode, color: 'var(--ov-success-default)' };
    case '.proto':
      return { icon: LuFileCode, color: 'var(--ov-warning-default)' };
    case '.sql':
      return { icon: LuFileCode, color: '#336791' };
    case '.jsonc':
      return { icon: LuBraces, color: '#F5C518' };
    default:
      return { icon: LuFile, color: 'var(--ov-fg-muted)' };
  }
}

export default function FileIcon({
  filename,
  size = 'sm',
  sx,
}: FileIconProps) {
  const iconSize = iconSizeMap[size];
  const lastDot = filename.lastIndexOf('.');
  const ext = lastDot >= 0 ? filename.slice(lastDot).toLowerCase() : '';
  const basename = filename.split('/').pop() ?? filename;
  const { icon: Icon, color } = getIconForExt(ext, basename);

  return (
    <Box
      component="span"
      sx={{
        display: 'inline-flex',
        color,
        flexShrink: 0,
        ...((typeof sx === 'object' && !Array.isArray(sx)) ? sx : {}),
      } as SxProps<Theme>}
    >
      <Icon size={iconSize} />
    </Box>
  );
}

FileIcon.displayName = 'FileIcon';
