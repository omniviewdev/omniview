import React from 'react';
import { Checkbox, Popover, Text, TextField } from '@omniviewdev/base-ui';
import type { HomepageCardConfig, HomepageCardMeta } from '@/features/extensions/homepage/types';
import styles from './HomepageCardConfigPopover.module.css';

type Props = {
  anchorEl: HTMLElement | null;
  onClose: () => void;
  meta: HomepageCardMeta;
  config: HomepageCardConfig;
  onConfigChange: (config: HomepageCardConfig) => void;
};

const HomepageCardConfigPopover: React.FC<Props> = ({
  anchorEl,
  onClose,
  meta,
  config,
  onConfigChange,
}) => {
  const [maxItemsInput, setMaxItemsInput] = React.useState(String(config.maxItems ?? 5));
  const allSections = meta.defaultConfig.sections;

  const toggleSection = (section: string) => {
    const next = config.sections.includes(section)
      ? config.sections.filter((s) => s !== section)
      : [...config.sections, section];
    onConfigChange({ ...config, sections: next });
  };

  const handleMaxItems = (e: React.ChangeEvent<HTMLInputElement>) => {
    setMaxItemsInput(e.target.value);
    const val = parseInt(e.target.value, 10);
    if (!isNaN(val) && val >= 1 && val <= 20) {
      onConfigChange({ ...config, maxItems: val });
    }
  };

  const maxItemsError = (() => {
    const val = parseInt(maxItemsInput, 10);
    if (isNaN(val) || val < 1) return 'Must be at least 1';
    if (val > 20) return 'Must be at most 20';
    return null;
  })();

  return (
    <Popover.Root
      open={Boolean(anchorEl)}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Popover.Portal>
        <Popover.Positioner anchor={anchorEl} side='bottom' align='end' sideOffset={4}>
          <Popover.Popup className={styles.Popup}>
            <div className={styles.Body}>
              <Text size='sm' weight='semibold'>
                Card Settings
              </Text>

              <div className={styles.Sections}>
                <Text size='xs' tone='muted'>
                  Sections
                </Text>
                <div className={styles.SectionList}>
                  {allSections.map((section) => (
                    <Checkbox
                      key={section}
                      size='sm'
                      checked={config.sections.includes(section)}
                      onCheckedChange={() => {
                        toggleSection(section);
                      }}
                    >
                      <Text size='sm'>{section}</Text>
                    </Checkbox>
                  ))}
                </div>
              </div>

              <TextField.Root size='sm' invalid={Boolean(maxItemsError)} className={styles.Field}>
                <TextField.Label>Max items per section</TextField.Label>
                <TextField.Control
                  type='number'
                  value={maxItemsInput}
                  onChange={handleMaxItems}
                  min={1}
                  max={20}
                />
                {maxItemsError && (
                  <Text size='xs' tone='danger'>{maxItemsError}</Text>
                )}
              </TextField.Root>
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
};

export default HomepageCardConfigPopover;
