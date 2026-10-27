import React from 'react';

import { Text } from '@omniviewdev/base-ui';

// Types
import { SettingsFocusContext, type SectionSelection } from './settingsContext';
import SettingsEntry from './SettingsEntry';
import type { Setting } from '@omniviewdev/runtime/models';
import { useDevMode } from '@/hooks/useDevMode';
import styles from './SettingsEntries.module.css';

type Props = SectionSelection & {
  settings: Record<string, Setting | undefined>;
  draftValues: Record<string, any>;
  setDraftValues: (draftValues: Record<string, any>) => void;
  renderSetting?: Readonly<Record<string, () => React.ReactNode>>;
  validation?: Record<string, { valid: boolean; message: string }>;
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
  validation,
}) => {
  const devMode = useDevMode();
  const focusRequest = React.useContext(SettingsFocusContext);
  const focusTarget = focusRequest?.settingId;
  const root = React.useRef<HTMLDivElement>(null);
  const fulfilledFocus = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (!focusRequest) {
      fulfilledFocus.current = null;
      return;
    }

    const token = JSON.stringify([sectionID, focusRequest.requestKey, focusRequest.settingId]);
    if (fulfilledFocus.current === token) {
      return;
    }

    const row = document.getElementById(`setting-${encodeURIComponent(focusRequest.settingId)}`);
    if (!row || !root.current?.contains(row)) {
      return;
    }

    row.scrollIntoView({ block: 'nearest' });
    const editor = row.querySelector<HTMLElement>('input:not(:disabled):not([type="hidden"]):not([tabindex="-1"]), button:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]');
    (editor ?? row).focus();
    if (editor && document.activeElement !== editor && !editor.contains(document.activeElement)) {
      row.focus();
    }

    fulfilledFocus.current = token;
  }, [focusRequest, settings, sectionID]);

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
    <div ref={root} className={styles.Root}>
      {focusTarget && !visibleSettings.some(([id]) => `${sectionID}.${id}` === focusTarget)
        && <p role='status'>Requested setting is unavailable.</p>}
      {visibleSettings.map(([id, setting]) => {
        const fullID = `${sectionID}.${id}`;
        const renderOverride = renderSetting?.[fullID];

        return (
          <div key={id} id={`setting-${encodeURIComponent(fullID)}`} data-setting-id={fullID} className={styles.Row} tabIndex={-1} role='group' aria-label={setting.label}>
            {/* Label + description column */}
            <div className={styles.LabelColumn}>
              <Text weight='semibold' size='sm'>{setting.label}</Text>
              <Text size='xs' tone='muted' className={styles.Description}>{setting.description}</Text>
              {draftValues[fullID] !== undefined && (
                <Text size='xs' tone='warning'>Unsaved change</Text>
              )}
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
              {validation?.[fullID] && (
                <p role='status' aria-live='polite'>
                  {validation[fullID].valid ? 'Valid: ' : ''}{validation[fullID].message}
                </p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default SettingsEntries;
