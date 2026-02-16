import type { IconType } from 'react-icons';
import {
  LuFolder,
  LuStar,
  LuServer,
  LuCloud,
  LuDatabase,
  LuShield,
  LuGlobe,
  LuZap,
  LuBox,
  LuLayers,
  LuCpu,
  LuHardDrive,
  LuNetwork,
  LuLock,
  LuFlame,
  LuRocket,
  LuBug,
  LuTestTube,
  LuWrench,
  LuCode,
  LuGitBranch,
  LuContainer,
  LuActivity,
  LuEye,
  LuTarget,
} from 'react-icons/lu';

export const FOLDER_ICON_MAP: Record<string, IconType> = {
  LuFolder,
  LuStar,
  LuServer,
  LuCloud,
  LuDatabase,
  LuShield,
  LuGlobe,
  LuZap,
  LuBox,
  LuLayers,
  LuCpu,
  LuHardDrive,
  LuNetwork,
  LuLock,
  LuFlame,
  LuRocket,
  LuBug,
  LuTestTube,
  LuWrench,
  LuCode,
  LuGitBranch,
  LuContainer,
  LuActivity,
  LuEye,
  LuTarget,
};

export const PRESET_COLORS: string[] = [
  '#2196F3', // blue
  '#4CAF50', // green
  '#FF9800', // orange
  '#F44336', // red
  '#9C27B0', // purple
  '#009688', // teal
  '#E91E63', // pink
  '#607D8B', // slate
  '#FFC107', // yellow
  '#795548', // brown
];

export function getFolderIcon(name?: string): IconType {
  if (name && FOLDER_ICON_MAP[name]) {
    return FOLDER_ICON_MAP[name];
  }
  return LuFolder;
}
