import React from 'react';

import { Text } from '@omniviewdev/base-ui';

// Types
import { type SectionSelection } from '.';
import SettingsEntry from './SettingsEntry';
import type { Setting } from '@omniviewdev/runtime/models';
import { useDevMode } from '@/hooks/useDevMode';
import styles from './SettingsEntries.module.css';

type Props = SectionSelection & {
  settings: Record<string, Setting>;
  draftValues: Record<string, any>;
  setDraftValues: (draftValues: Record<string, any>) => void;
};

/**
 * Displays and allows modification to application settings, given a settings namespace and section.
 */
const SettingsEntries: React.FC<Props> = ({ id: sectionID, settings, draftValues, setDraftValues }) => {
  const devMode = useDevMode();

  const handleChange = (name: string, value: any) => {
    const id = `${sectionID}.${name}`;
    setDraftValues({ ...draftValues, [id]: value });
  };

  if (!settings) {
    return <></>;
  }

  const visibleSettings = Object.entries(settings).filter(
    ([, setting]) => !setting.devOnly || devMode,
  );

  return (
    <div className={styles.Root}>
      {visibleSettings.map(([id, setting]) => (
        <div key={id} className={styles.Row}>
          {/* Label + description column */}
          <div className={styles.LabelColumn}>
            <Text weight='semibold' size='sm'>{setting.label}</Text>
            <Text size='xs' tone='muted' className={styles.Description}>{setting.description}</Text>
            {sectionID !== 'plugin' && (
              <Text size='xs' tone='subtle' mono className={styles.Key}>
                {sectionID}.{id}
              </Text>
            )}
          </div>
          {/* Input column */}
          <div className={styles.InputColumn}>
            <SettingsEntry
              setting={setting}
              id={id}
              draftValue={draftValues[`${sectionID}.${id}`]}
              handleChange={handleChange}
            />
          </div>
        </div>
      ))}
    </div>
  );
};

export default SettingsEntries;
