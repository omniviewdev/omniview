export type HeaderAreaLocation = 'left' | 'center' | 'right';
export type HeaderAreaType = 'items' | 'search' | 'tabs' | 'context';

/**
 * Redux store for the header component and it's state.
 */
export interface HeaderState {
  visible: boolean;
  areas: Record<HeaderAreaLocation, HeaderArea>;
}


export interface HeaderArea {
  visible: boolean;
  type: HeaderAreaType;
  items?: HeaderAreaItem[];
}

// ======================================== HeaderAreaItem ======================================== //

export enum HeaderAreaItemType {
  BUTTON = 'button',
  LINK = 'link',
  MENU = 'menu',
  MODAL = 'modal',
}

export type HeaderAreaItemListType = HeaderIconButton | HeaderIconLink | HeaderIconMenu | HeaderIconModal;
export type HeaderAreaItemList = Array<HeaderAreaItemListType>

export interface HeaderAreaItem {
  /** 
   * Unique identifier for the item. 
   */
  id: string;

  /**
   * Type of the item. See the HeaderAreaItemType for available options 
   */
  type: HeaderAreaItemType;

  /**
   * Optional helper text to display for the item. If specified, it will be
   * displayed in a tooltip when the user hovers over the item for an extended period of time.
   */
  helpText?: string;

  /** 
   * Icon to display for the item. All icons found in the 'react-icons' library are supported by 
   * the same string identifier.
   */
  icon?: string;
}

export interface HeaderIconButton extends HeaderAreaItem {
  type: HeaderAreaItemType.BUTTON;
  icon: string;
  onClick: () => void;
}

export interface HeaderIconLink extends HeaderAreaItem {
  type: HeaderAreaItemType.LINK;
  icon: string;
  href: string;
}

export interface HeaderIconModal extends HeaderAreaItem {
  type: HeaderAreaItemType.MODAL;
  icon: string;
  // the modal should be a lazy loadable component, as we really shouldn't be
  // passing react nodes up to the redux store
  modal: React.LazyExoticComponent<React.ComponentType<any>>;
  modalProps?: any;
  modalDimensions?: { width: string, height: string };
}


export interface HeaderIconMenu extends HeaderAreaItem {
  type: HeaderAreaItemType.MENU;
  icon: string;
  items: HeaderIconMenuItem[];
}

// ======================================== HeaderMenuItem ======================================== //

export interface HeaderIconMenuItem {
  id: string;
  label: string;
  icon?: string;
  link?: string;
  onClick?: () => void;
  children?: HeaderIconMenuItem[];
}


