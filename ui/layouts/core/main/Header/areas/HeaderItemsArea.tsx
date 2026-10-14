import React from 'react';
import HeaderIconMenu from './components/HeaderIconMenu';
import HeaderIconButton from './components/HeaderIconButton';
import HeaderIconLink from './components/HeaderIconLink';

// Project-imports
import { type HeaderAreaItemList, type HeaderAreaItemListType, HeaderAreaItemType } from '@/store/header/types';
import { toggleMaximiseOnDoubleClick } from '../toggleMaximise';
import styles from '../Header.module.css';

type Props = {
  /** The items to display in the header. */
  items: HeaderAreaItemList;
};

/**
 * Display items within an item area on the header
 */
const HeaderItemsArea: React.FC<Props> = ({ items }) => (
  <div onClick={toggleMaximiseOnDoubleClick} className={styles.ItemsArea}>
    {items.map(item => <HeaderItemComponent key={item.id} item={item} />)}
  </div>
);

const HeaderItemComponent = ({ item }: { item: HeaderAreaItemListType }): React.ReactElement => {
  switch (item.type) {
    case HeaderAreaItemType.BUTTON:
      return <HeaderIconButton {...item} />;
    case HeaderAreaItemType.LINK:
      return <HeaderIconLink {...item} />;
    case HeaderAreaItemType.MENU:
      return <HeaderIconMenu {...item} />;
    case HeaderAreaItemType.MODAL:
      // Not defined yet for now
      return <></>;
  }
};

export default HeaderItemsArea;
