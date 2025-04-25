
/**
 * Entry into the sidebar. Can be a top level item or a child item.
 */
export type SidebarItem = {
  /** Internal identifier */
  id: string;

  /** Human readable label */
  label: string;

  /** Optional chip to display next to the label */
  decorator?: string | React.ReactNode;

  /**
   * Icon to display. This can be either:
  * - A string representing a React Icons name
  *   - e.g. "FiHome"
  *   - See: https://react-icons.github.io/react-icons/
  * - A React Node of the icon component
  *   - e.g. <ChevronRight />
  * - A string representing the data URI of an image
  *   - e.g. "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTAwIiBoZWlnaHQ9IjEwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4="
  *   - See: https://developer.mozilla.org/en-US/docs/Web/HTTP/Basics_of_HTTP/Data_URIs
   */
  icon: string | React.ReactNode;

  /** Child items */
  children?: SidebarItem[];

  /** Default the item to be expanded if it has children */
  defaultExpanded?: boolean;
};

/**
 * A section within the sidebar to group items together. Sections are not collapsible, and
 * merely provide a visual separation between items.
 */
export type SidebarSection = {
  /** The id of the section */
  id: string;

  /** The title of the section */
  title: string;

  /** The items to display in the section */
  items: SidebarItem[];
};

export type SidebarProps = {
  /**
   * Optional title to display at the top of the sidebar
   */
  header?: React.ReactNode;

  /**
   * Size to render the list as. Defaults to "md"
   */
  size?: 'sm' | 'md' | 'lg';

  /**
   * The sections to display in the sidebar
   * Mutually exclusive with `items`
   */
  sections?: SidebarSection[];

  /**
   * Display the sidebar as items instead of using sections
   * Mutually exclusive with `sections`
   */
  items?: SidebarItem[];

  /**
   * Mark the list as scrollable and takes the full height of the container
   */
  scrollable?: boolean;

  /**
  * The currently selected item
  */
  selected: string | undefined;

  /**
  * Callback to handle the selection of an item
  */
  onSelect: (id: string) => void;
};

/**
 * Props for the sidebar list item
 */
export type SidebarListItemProps = {
  /** The level of nesting for the item */
  level?: number;

  /** The item to render */
  item: SidebarItem;

  /** The ID of the parent item */
  parentID?: string;

  /** The open state of various items within the sidebar */
  openState: Record<string, boolean>;

  /** Callback to toggle the open state of an item */
  onToggleOpen: (id: string) => void;

  /** The currently selected item */
  selected: string | undefined;

  /** Callback to handle the selection of an item */
  onSelect: (id: string) => void;
};
