import React from 'react';
import { IconButton } from '@omniviewdev/base-ui';

// Project imports
import { type HeaderIconButton as HeaderIconButtonProps } from '@/store/header/types';
import { Icon } from '@/components/icons/Icon';
import HintTooltip from '@/components/base/HintTooltip';
import styles from '../../Header.module.css';

type Props = HeaderIconButtonProps;

/**
 * A button with a defined action in the header. Does not link to any other pages in the application.
 */
const HeaderIconButton: React.FC<Props> = ({ helpText, icon, onClick }) => (
  <HintTooltip content={helpText}>
    <IconButton size='sm' variant='ghost' color='neutral' onClick={onClick} className={styles.NoDrag} aria-label={helpText}>
      <Icon name={icon} />
    </IconButton>
  </HintTooltip>
);

export default HeaderIconButton;
