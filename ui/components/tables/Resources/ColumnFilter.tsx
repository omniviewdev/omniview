import React from 'react';

import { Checkbox, IconButton, Popover, Separator, Text } from '@omniviewdev/base-ui';

// icons
import { LuColumns2, LuSettings2 } from 'react-icons/lu';
import { type Column } from '@tanstack/react-table';

import styles from './ColumnFilter.module.css';

type Props = {
  anchorEl: HTMLElement | undefined;
  columns: Array<Column<any>>;
  onClose: () => void;
  onClick: React.MouseEventHandler<HTMLAnchorElement>;
};

const ColumnFilter: React.FC<Props> = ({ anchorEl, columns, onClose, onClick }) => {
  const open = Boolean(anchorEl);

  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        // Opening is driven by the trigger's onClick (which sets the anchor);
        // base-ui reports outside presses / escape as a close request.
        if (!next) {
          onClose();
        }
      }}
    >
      <Popover.Trigger
        render={
          <IconButton
            variant='outline'
            color='neutral'
            aria-label='Columns'
            onClick={onClick as unknown as React.MouseEventHandler<HTMLButtonElement>}
          >
            <LuSettings2 size={20} />
          </IconButton>
        }
      />
      <Popover.Portal>
        <Popover.Positioner side='bottom' align='end' sideOffset={4}>
          <Popover.Popup id={'table-filter-menu'} className={styles.Popup}>
            <Text weight="semibold" size="sm" className={styles.Heading}><LuColumns2 size={14}/> Columns</Text>
            <Separator />
            <div className={styles.ColumnList}>
              {columns.filter(col => col.getCanHide()).map((column) => (
                <Checkbox
                  key={column.columnDef.id}
                  size='sm'
                  checked={column.getIsVisible()}
                  onCheckedChange={(checked) => {
                    column.toggleVisibility(checked);
                  }}
                  className={styles.ColumnRow}
                >
                  {column.columnDef.header?.toString()}
                </Checkbox>
              ))}
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
};

ColumnFilter.displayName = 'ColumnFilter';
ColumnFilter.whyDidYouRender = true;

export default ColumnFilter;
