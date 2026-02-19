import type { ReactNode } from 'react';
import type { SemanticColor } from '../types';

export interface ContextMenuItem {
  key: string;
  label: string;
  icon?: ReactNode;
  shortcut?: string[];
  color?: SemanticColor;
  disabled?: boolean;
  dividerAfter?: boolean;
  children?: ContextMenuItem[];
  onClick?: () => void;
}

export interface MenuBarItem {
  key: string;
  label: string;
  items: ContextMenuItem[];
}

export interface SplitButtonOption {
  key: string;
  label: string;
  icon?: ReactNode;
  disabled?: boolean;
}
