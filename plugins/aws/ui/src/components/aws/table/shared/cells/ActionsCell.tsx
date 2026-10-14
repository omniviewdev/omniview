import React from 'react';
import { IconButton, Menu } from '@omniviewdev/base-ui';
import { LuEllipsis } from 'react-icons/lu';

type Props = {
  connectionID: string;
  resourceID: string;
  resourceKey: string;
  data: unknown;
};

const popupStyle: React.CSSProperties = { maxWidth: 400, minWidth: 110 };

const ActionsCell: React.FC<Props> = () => {
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    const handleScroll = () => { setOpen(false); };
    window.addEventListener('scroll', handleScroll, true);
    return () => { window.removeEventListener('scroll', handleScroll, true); };
  }, [open]);

  return (
    <Menu.Root open={open} onOpenChange={setOpen} size='sm'>
      <Menu.Trigger
        render={
          <IconButton size="sm" variant="ghost" aria-label="Resource actions" style={{ flex: 'none' }}>
            <LuEllipsis />
          </IconButton>
        }
      />
      <Menu.Portal>
        <Menu.Positioner side='bottom' align='end' sideOffset={4}>
          <Menu.Popup style={popupStyle}>
            {/* AWS plugin is read-only, no actions yet */}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
};

ActionsCell.displayName = 'ActionsCell';
export default ActionsCell;
