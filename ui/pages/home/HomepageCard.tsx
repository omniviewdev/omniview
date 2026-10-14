import React, { useMemo } from 'react';
import { Button, Chip, IconButton, Text } from '@omniviewdev/base-ui';
import { ErrorBoundary, type FallbackProps } from 'react-error-boundary';
import { LuEye, LuEyeOff, LuRotateCw, LuSettings, LuTriangleAlert } from 'react-icons/lu';
import { PluginContext } from '@omniviewdev/runtime';
import { PluginMeta } from '@omniviewdev/runtime/models';
import type { ExtensionContributionRegistration } from '@omniviewdev/runtime';
import type { HomepageCardProps, HomepageCardMeta, HomepageCardConfig } from '@/features/extensions/homepage/types';
import HintTooltip from '@/components/base/HintTooltip';
import HomepageCardConfigPopover from './HomepageCardConfigPopover';
import styles from './HomepageCard.module.css';

/**
 * Card-specific error fallback that fills the card content area with a
 * centered, visually integrated error state.
 */
function CardErrorFallback({ error, resetErrorBoundary, label }: FallbackProps & { label: string }) {
  return (
    <div className={styles.ErrorFallback}>
      <div className={styles.ErrorIcon}>
        <LuTriangleAlert size={20} />
      </div>
      <div className={styles.ErrorText}>
        <Text size='sm' weight='semibold'>
          {label} failed to load
        </Text>
        <Text size='xs' tone='muted' className={styles.ErrorMessage}>
          {error.message.length > 120 ? error.message.slice(0, 120) + '…' : error.message}
        </Text>
      </div>
      <Button
        size='sm'
        variant='outline'
        color='neutral'
        onClick={resetErrorBoundary}
        startDecorator={<LuRotateCw size={13} />}
      >
        Retry
      </Button>
    </div>
  );
}

type Props = {
  registration: ExtensionContributionRegistration<React.FC<HomepageCardProps>>;
  config: HomepageCardConfig;
  isHidden: boolean;
  isEditMode: boolean;
  onToggleHidden: () => void;
  onConfigChange: (config: HomepageCardConfig) => void;
};

const HomepageCard: React.FC<Props> = ({
  registration,
  config,
  isHidden,
  isEditMode,
  onToggleHidden,
  onConfigChange,
}) => {
  const [configAnchor, setConfigAnchor] = React.useState<HTMLElement | null>(null);

  const providerValue = useMemo(() => ({
    pluginId: registration.plugin,
    meta: new PluginMeta(),
    settings: {},
  }), [registration.plugin]);

  // In normal mode, hidden cards are not rendered
  if (isHidden && !isEditMode) {
    return null;
  }

  const meta = registration.meta as HomepageCardMeta | undefined;
  const Component = registration.value;

  return (
    <div className={styles.Card} data-hidden={isHidden && isEditMode}>
      {/* Edit-mode toolbar */}
      {isEditMode && (
        <div className={styles.Toolbar}>
          <div className={styles.ToolbarActions}>
            {isHidden && (
              <Chip size='xs' variant='soft' color='neutral' className={styles.HiddenChip}>Hidden</Chip>
            )}
            <HintTooltip content={isHidden ? 'Show card' : 'Hide card'}>
              <IconButton
                size='sm'
                variant='ghost'
                color='neutral'
                aria-label={isHidden ? 'Show card' : 'Hide card'}
                onClick={onToggleHidden}
              >
                {isHidden ? <LuEye size={16} /> : <LuEyeOff size={16} />}
              </IconButton>
            </HintTooltip>
            {meta && (
              <HintTooltip content='Card settings'>
                <IconButton
                  size='sm'
                  variant='ghost'
                  color='neutral'
                  aria-label='Card settings'
                  onClick={(e) => {
                    setConfigAnchor(e.currentTarget); 
                  }}
                >
                  <LuSettings size={16} />
                </IconButton>
              </HintTooltip>
            )}
          </div>
        </div>
      )}

      {/* Card icon header */}
      <div className={styles.IconHeader}>
        {meta?.icon ? (
          <HintTooltip content={registration.label}>
            <div className={styles.Icon}>
              <meta.icon size={48} />
            </div>
          </HintTooltip>
        ) : (
          <Text size='sm' weight='semibold'>{registration.label}</Text>
        )}
      </div>

      {/* Card content — wrapped in per-card error boundary so a single
          plugin crash doesn't take down the entire homepage */}
      <div className={styles.Content}>
        <ErrorBoundary
          FallbackComponent={(props) => (
            <CardErrorFallback {...props} label={registration.label ?? registration.plugin} />
          )}
          resetKeys={[registration.id]}
        >
          <PluginContext.Provider value={providerValue}>
            <Component pluginID={registration.plugin} config={config} />
          </PluginContext.Provider>
        </ErrorBoundary>
      </div>

      {/* Config popover */}
      {meta && (
        <HomepageCardConfigPopover
          anchorEl={configAnchor}
          onClose={() => {
            setConfigAnchor(null); 
          }}
          meta={meta}
          config={config}
          onConfigChange={(next) => {
            onConfigChange(next);
            setConfigAnchor(null);
          }}
        />
      )}
    </div>
  );
};

export default HomepageCard;
