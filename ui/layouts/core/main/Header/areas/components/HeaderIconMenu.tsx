import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { IconButton, Menu } from '@omniviewdev/base-ui';

// Project imports
import Icon from '@/components/icons/Icon';
import { type HeaderIconMenu as HeaderIconMenuProps } from '@/store/header/types';
import HintTooltip from '@/components/base/HintTooltip';
import styles from '../../Header.module.css';

type Props = HeaderIconMenuProps;

/**
 * Display a drop down menu as a header icon
 */
const HeaderIconMenu: React.FC<Props> = ({ id, icon, helpText, items }) => {
  const navigate = useNavigate();

  return (
    <Menu.Root>
      <HintTooltip content={helpText}>
        <Menu.Trigger
          render={
            <IconButton size='sm' variant='soft' color='neutral' aria-label={helpText || 'Apps'} className={styles.NoDrag}>
              <Icon name={icon} />
            </IconButton>
          }
        />
      </HintTooltip>
      <Menu.Portal>
        <Menu.Positioner align='end' sideOffset={4}>
          <Menu.Popup id={id} style={{ minWidth: 120 }}>
            {items.map(({ label, icon: itemIcon, link }) => (
              <Menu.Item
                key={label}
                startDecorator={itemIcon ? <Icon name={itemIcon} /> : undefined}
                onClick={link ? () => navigate(link) : undefined}
              >
                {label}
              </Menu.Item>
            ))}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
};

export default HeaderIconMenu;
