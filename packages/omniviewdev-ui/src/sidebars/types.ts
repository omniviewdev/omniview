import type React from 'react';

export interface ActivityBarItem {
  id: string;
  icon: React.ReactNode;
  label: string;
  badge?: number | boolean;
}

export interface PropertyGridItem {
  key: string;
  label: string;
  value: React.ReactNode;
  type?: 'text' | 'boolean' | 'color' | 'link' | 'code';
  copyable?: boolean;
  editable?: boolean;
}

export interface NavSection {
  title: string;
  items: NavMenuItem[];
}

export interface NavMenuItem {
  id: string;
  label: string;
  icon?: React.ReactNode;
  badge?: React.ReactNode;
  children?: NavMenuItem[];
  disabled?: boolean;
  /** Start expanded when first rendered. Only relevant for items with children. */
  defaultExpanded?: boolean;
}
