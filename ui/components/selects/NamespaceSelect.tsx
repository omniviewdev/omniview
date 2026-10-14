import React from 'react';

import { MultiSelect } from '@omniviewdev/base-ui';

import styles from './NamespaceSelect.module.css';

type Props = {
  /** The available namespaces. */
  available: string[];

  /** The currently selected namespaces. */
  selected: string[];

  /** Set the selected namespaces. */
  setNamespaces: (namespaces: string[]) => void;
};

/**
  * Renders a select for choosing namespaces.
  */
const NamespaceSelect: React.FC<Props> = ({ available, selected, setNamespaces }) => {
  return (
    <MultiSelect
      size='sm'
      variant='outline'
      items={available}
      value={selected}
      onValueChange={(values) => {
        setNamespaces(values);
      }}
      placeholder='All Namespaces'
      searchPlaceholder='Search namespaces...'
      triggerLabel='Namespaces'
      maxVisibleChips={2}
      clearable
      className={styles.Root}
      popupClassName={styles.Popup}
    />
  );
};

export default NamespaceSelect;
