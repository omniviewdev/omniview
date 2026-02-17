export type SidebarItem = {
  id: string;
  label: string;
  decorator?: string | React.ReactNode;
  icon: string | React.ReactNode;
  children?: SidebarItem[];
  defaultExpanded?: boolean;
};

export type SidebarSection = {
  id: string;
  title: string;
  items: SidebarItem[];
};

export type SidebarProps = {
  header?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg';
  sections?: SidebarSection[];
  items?: SidebarItem[];
  scrollable?: boolean;
};

export type SidebarListItemProps = {
  level?: number;
  item: SidebarItem;
  parentID?: string;
  openState: Record<string, boolean>;
  onToggleOpen: (id: string) => void;
  selected: string | undefined;
  onSelect: (id: string) => void;
};
