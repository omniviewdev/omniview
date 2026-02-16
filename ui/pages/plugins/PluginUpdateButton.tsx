import * as React from 'react';
import Button from '@mui/joy/Button';
import IconButton from '@mui/joy/IconButton';
import ButtonGroup from '@mui/joy/ButtonGroup';
import Menu from '@mui/joy/Menu';
import MenuItem from '@mui/joy/MenuItem';
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown';
import { usePlugin } from '@/hooks/plugin/usePluginManager';
import { ClickAwayListener } from '@mui/base';

type Props = {
  pluginID: string
  currentVersion?: string
  installed?: boolean
}

export default function PluginUpdateButton({ pluginID, currentVersion, installed }: Props) {
  const [open, setOpen] = React.useState(false);
  const actionRef = React.useRef<() => void>(null);
  const anchorRef = React.useRef<HTMLDivElement>(null);

  const { versions, update } = usePlugin({ id: pluginID });

  const handleMenuItemClick = (
    _: React.MouseEvent<HTMLElement, MouseEvent>,
    version: string,
  ) => {
    console.log('updating to ', version)
    setOpen(false);
    update(version)
  };

  if (!versions.data?.Versions) {
    return <></>
  }

  return (
    <React.Fragment>
      <ButtonGroup
        ref={anchorRef}
        variant="soft"
        color='primary'
      >
        <Button
          disabled={installed && currentVersion === versions.data.Latest}
          onClick={() => update(versions.data.Latest)}>
          {!installed ? 'Install' : currentVersion === versions.data.Latest ? 'Updated' : 'Update'}
        </Button>
        <IconButton
          aria-controls={open ? 'split-button-menu' : undefined}
          aria-expanded={open ? 'true' : undefined}
          aria-label="select merge strategy"
          aria-haspopup="menu"
          onMouseDown={() => {
            // @ts-ignore
            actionRef.current = () => setOpen(!open);
          }}
          onKeyDown={() => {
            // @ts-ignore
            actionRef.current = () => setOpen(!open);
          }}
          onClick={() => {
            actionRef.current?.();
          }}
        >
          <ArrowDropDownIcon />
        </IconButton>
      </ButtonGroup>
      <Menu
        sx={{
          maxHeight: '300px',
          overflow: 'auto',
        }}
        size='sm'
        open={open}
        onClose={() => setOpen(false)}
        anchorEl={anchorRef.current}
      >
        {versions.data.Versions.reverse().map((option) => (
          <MenuItem
            sx={{ minWidth: '200px' }}
            key={option}
            onClick={(event) => handleMenuItemClick(event, option)}
          >
            {option}
          </MenuItem>
        ))}
      </Menu>
    </React.Fragment>
  );
}
