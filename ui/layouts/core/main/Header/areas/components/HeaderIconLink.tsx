import React from 'react';
import { useNavigate } from 'react-router-dom';
import { IconButton } from '@omniviewdev/base-ui';

// Project imports
import { type HeaderIconLink as HeaderIconLinkProps } from '@/store/header/types';
import { Icon } from '@/components/icons/Icon';
import HintTooltip from '@/components/base/HintTooltip';
import styles from '../../Header.module.css';

type Props = HeaderIconLinkProps;

/**
 * A header button that navigates to another page in the application.
 */
const HeaderIconLink: React.FC<Props> = ({ id, helpText, icon, href }) => {
  const navigate = useNavigate();

  return (
    <HintTooltip content={helpText}>
      <IconButton
        size='sm'
        variant='ghost'
        color='neutral'
        className={styles.NoDrag}
        aria-label={helpText || id}
        onClick={() => navigate(href)}
      >
        <Icon name={icon} size={16} />
      </IconButton>
    </HintTooltip>
  );
};

export default HeaderIconLink;
