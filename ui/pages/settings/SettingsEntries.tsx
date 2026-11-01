import React from 'react';

import { IconButton, Text } from '@omniviewdev/base-ui';
import { LuInfo } from 'react-icons/lu';
import HintTooltip from '@/components/base/HintTooltip';

// Types
import { Section, SettingsFocusContext, type SectionSelection } from './settingsContext';
import SettingsEntry from './SettingsEntry';
import type { Setting } from '@omniviewdev/runtime/models';
import { useDevMode } from '@/hooks/useDevMode';
import styles from './SettingsEntries.module.css';
import { PluginSettingEditor } from '@/features/settings-editors';

type Props = SectionSelection & {
  settings: Record<string, (Setting & { requiresRestart?: boolean; pendingRestart?: boolean }) | undefined>;
  draftValues: Record<string, unknown>;
  setDraftValues: (draftValues: Record<string, unknown>) => void;
  renderSetting?: Readonly<Record<string, () => React.ReactNode>>;
  presentation?: Readonly<Record<string, { label: string; help: string }>>;
  validation?: Record<string, { valid: boolean; message: string }>;
  disabled?: boolean;
};

/**
 * Displays and allows modification to application settings, given a settings namespace and section.
 */
const SettingsEntries: React.FC<Props> = ({
  id: sectionID,
  section,
  settings,
  draftValues,
  setDraftValues,
  renderSetting,
  presentation,
  validation,
  disabled,
}) => {
  const devMode = useDevMode();
  const focusRequest = React.useContext(SettingsFocusContext);
  const focusTarget = focusRequest?.settingId;
  const root = React.useRef<HTMLDivElement>(null);
  const fulfilledFocus = React.useRef<string | null>(null);

  React.useEffect(() => {
    let observer: MutationObserver | undefined;
    const focus = () => {
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
      const editor = row.querySelector(`.${styles.InputColumn}`)?.querySelector<HTMLElement>('input:not(:disabled):not([type="hidden"]):not([tabindex="-1"]), button:not(:disabled):not([tabindex="-1"]), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]');
      (editor ?? row).focus();
      if (editor && document.activeElement !== editor && !editor.contains(document.activeElement)) {
        row.focus();
      }

      if (editor) {
        fulfilledFocus.current = token;
        observer?.disconnect();
      }
    };

    focus();
    if (root.current) {
      observer = new MutationObserver(focus);
      observer.observe(root.current, { childList: true, subtree: true });
    }

    return () => observer?.disconnect();
  }, [focusRequest, settings, sectionID]);

  const settingID = (name: string) => section === Section.Core ? `${sectionID}.${name}` : name;
  const handleChange = (name: string, value: unknown) => {
    setDraftValues({ ...draftValues, [settingID(name)]: value });
  };

  if (!settings) {
    return <></>;
  }

  const visibleSettings = Object.entries(settings).filter(
    (entry): entry is [string, Setting & { requiresRestart?: boolean; pendingRestart?: boolean }] => entry[1] !== undefined && (!entry[1].devOnly || devMode),
  );

  return (
    <div ref={root} className={styles.Root}>
      {focusTarget && !visibleSettings.some(([id]) => settingID(id) === focusTarget)
        && <p role='status'>Requested setting is unavailable.</p>}
      {visibleSettings.map(([id, setting]) => {
        const fullID = settingID(id);
        const renderOverride = renderSetting?.[fullID];
        const display = presentation?.[fullID];
        const inputId = `setting-input-${encodeURIComponent(fullID)}`;
        const labelledBy = `${inputId}-label`;
        const describedBy = `${inputId}-description`;
        const generic = <SettingsEntry setting={setting} id={id} draftValue={draftValues[fullID]} handleChange={handleChange}
          inputId={inputId} labelledBy={labelledBy} describedBy={describedBy} />;

        return (
          <div key={id} id={`setting-${encodeURIComponent(fullID)}`} data-setting-id={fullID} className={`${styles.Row} ${renderOverride && fullID === 'appearance.theme' ? styles.ThemeRow : ''}`} tabIndex={-1} role='group' aria-label={display?.label ?? setting.label}>
            {/* Label + description column */}
            <div className={styles.LabelColumn}>
              <Text id={labelledBy} weight='semibold' size='sm'>
                {display?.label ?? setting.label}
                {display && <HintTooltip content={display.help}>
                  <IconButton size='xs' variant='ghost' color='neutral' aria-label={`${display.label} help`}>
                    <LuInfo size={13} />
                  </IconButton>
                </HintTooltip>}
              </Text>
              {!display && <Text id={describedBy} size='xs' tone='muted' className={styles.Description}>{setting.description}</Text>}
              {setting.requiresRestart && (
                <Text size='xs' tone='muted'>
                  {setting.pendingRestart ? 'Saved · Restart pending' : 'Requires restart'}
                </Text>
              )}
              {draftValues[fullID] !== undefined && (
                <Text size='xs' tone='warning'>Unsaved change</Text>
              )}
              {section === Section.Core && !display && (
                <Text size='xs' tone='subtle' mono className={styles.Key}>
                  {fullID}
                </Text>
              )}
            </div>
            {/* Input column */}
            <div className={styles.InputColumn}>
              {renderOverride
                ? renderOverride()
                : section === Section.Plugins ? (
                  <PluginSettingEditor pluginId={sectionID} settingId={fullID} setting={setting}
                    value={draftValues[fullID] !== undefined ? draftValues[fullID] : setting.value}
                    registerFocusTarget={element => {
                      const token = focusRequest && JSON.stringify([sectionID, focusRequest.requestKey, focusRequest.settingId]);
                      if (element && focusRequest?.settingId === fullID && fulfilledFocus.current !== token) {
                        element.scrollIntoView({ block: 'nearest' });
                        element.focus();
                        fulfilledFocus.current = token;
                      }
                    }}
                    dirty={draftValues[fullID] !== undefined} validation={validation?.[fullID]}
                    disabled={disabled}
                    inputId={inputId} labelledBy={labelledBy} describedBy={describedBy}
                    onChange={value => {
                      handleChange(id, value); 
                    }}>{generic}</PluginSettingEditor>
                ) : generic}
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
