import React from 'react';

import { Text } from '@omniviewdev/base-ui';

// Types
import { type SectionSelection } from '.';
import SettingsEntry from './SettingsEntry';
import type { Setting } from '@omniviewdev/runtime/models';
import { useDevMode } from '@/hooks/useDevMode';
import styles from './SettingsEntries.module.css';

type Props = SectionSelection & {
  settings: Record<string, Setting | undefined>;
  draftValues: Record<string, any>;
  setDraftValues: (draftValues: Record<string, any>) => void;
  renderSetting?: Readonly<Record<string, () => React.ReactNode>>;
};

/**
 * Displays and allows modification to application settings, given a settings namespace and section.
 */
const SettingsEntries: React.FC<Props> = ({
  id: sectionID,
  settings,
  draftValues,
  setDraftValues,
  renderSetting,
}) => {
  const devMode = useDevMode();

  const handleChange = (name: string, value: any) => {
    const id = `${sectionID}.${name}`;
    setDraftValues({ ...draftValues, [id]: value });
  };

  if (!settings) {
    return <></>;
  }

  const visibleSettings = Object.entries(settings).filter(
    (entry): entry is [string, Setting] => entry[1] !== undefined && (!entry[1].devOnly || devMode),
  );

  return (
    <div className={styles.Root}>
      {visibleSettings.map(([id, setting]) => {
        const fullID = `${sectionID}.${id}`;
        const renderOverride = renderSetting?.[fullID];

        return (
          <div key={id} className={styles.Row}>
            {/* Label + description column */}
            <div className={styles.LabelColumn}>
              <Text weight='semibold' size='sm'>{setting.label}</Text>
              <Text size='xs' tone='muted' className={styles.Description}>{setting.description}</Text>
              {sectionID !== 'plugin' && (
                <Text size='xs' tone='subtle' mono className={styles.Key}>
                  {fullID}
                </Text>
              )}
            </div>
            {/* Input column */}
            <div className={styles.InputColumn}>
              {renderOverride
                ? renderOverride()
                : (
                  <SettingsEntry
                    setting={setting}
                    id={id}
                    draftValue={draftValues[fullID]}
                    handleChange={handleChange}
                  />
                )}
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default SettingsEntries;
