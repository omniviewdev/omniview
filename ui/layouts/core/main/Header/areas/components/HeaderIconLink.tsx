import React from 'react';
import { IconButton } from '@omniviewdev/base-ui';
import { openSettings, settingsWindowTarget } from '@omniviewdev/runtime';

// Project imports
import { useActivePageNavigation } from '@/features/workspace/activePageNavigation';
import { type HeaderIconLink as HeaderIconLinkProps } from '@/store/header/types';
import { Icon } from '@/components/icons/Icon';
import HintTooltip from '@/components/base/HintTooltip';
import { orFallback } from '@/utils/orFallback';
import styles from '../../Header.module.css';

type Props = HeaderIconLinkProps;

/**
 * A header button that navigates to another page in the application.
 */
const HeaderIconLink: React.FC<Props> = ({ id, helpText, icon, href }) => {
  const { navigate } = useActivePageNavigation();
  const settingsTarget = settingsWindowTarget(href);
  const mac = /mac/i.test(navigator.userAgent);
  const label = orFallback(helpText, id);

  return (
    <HintTooltip content={settingsTarget !== null ? `${label} (${mac ? '⌘,' : 'Ctrl+,'})` : helpText}>
      <IconButton
        size='sm'
        variant='ghost'
        color='neutral'
        className={styles.NoDrag}
        aria-label={label}
        aria-keyshortcuts={settingsTarget !== null ? `${mac ? 'Meta' : 'Control'}+,` : undefined}
        onClick={() => {
          if (settingsTarget !== null) {
            void openSettings(settingsTarget).catch((error: unknown) => {
              console.error('[settings] opening Settings from the title bar failed', error);
            });
          } else {
            navigate(href);
          }
        }}
      >
        <Icon name={icon} size={16} />
      </IconButton>
    </HintTooltip>
  );
};

export default HeaderIconLink;
