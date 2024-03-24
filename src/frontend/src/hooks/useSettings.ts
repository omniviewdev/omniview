import { createSelector } from '@reduxjs/toolkit';
import { useSelector } from 'react-redux';
import { type RootState } from '@/store/store';
import { parseSettingIdentifier } from '@/store/settings/helpers';

// Memoized selectors to get settings from the redux store entirely, by section, or by individual setting.

const selectSettings = (state: RootState) => state.settings;

/**
 * Retrieves all settings within a namespace
 */
export const useSettingsNamespace = (namespace: string) => useSelector((state: RootState) =>
  createSelector(
    [selectSettings],
    settings => settings[namespace],
  )(state),
);

/**
 * Retrieves all the sections, excluding the settings themselves.
* This is useful for rendering a list of sections.
*/
export const useSettingsSections = () => useSelector((state: RootState) =>
  createSelector(
    [selectSettings],
    settings => Object.values(settings).map(namespace => ({
      id: namespace.id,
      label: namespace.label,
      description: namespace.description,
      icon: namespace.icon,
      private: namespace.private,
      sections: Object.values(namespace.sections).map(section => ({
        id: section.id,
        label: section.label,
        description: section.description,
        icon: section.icon,
        private: section.private,
      })),
    })),
  )(state),
);

/**
 * Retreives a single section by it's section key. It also enriches with the identifier
 * for the primary settings accessor to use.
 */
export const useSettingsNamespaceSection = (namespace: string, section: string) => useSelector((state: RootState) =>
  createSelector(
    [selectSettings],
    settings => {
      const sectionData = settings[namespace]?.sections[section];
      const identifier = `${namespace}.${section}`;

      const enrichedSettings = Object.entries(sectionData?.settings).map(([id, setting]) => ({
        ...setting,
        identifier: `${identifier}.${id}`,
      }));

      return {
        ...sectionData,
        settings: enrichedSettings,
      };
    })(state),
);

/**
 * Retrieves all settings within a section.
* @param namespace - The namespace of the section.
* @param section - The section key.
*/
export const useSectionSettings = (namespace: string, section: string) => useSelector((state: RootState) =>
  createSelector(
    [selectSettings],
    settings => settings[namespace]?.sections[section].settings,
  )(state),
);

/**
 * Retrieves a single setting by a namespace.section.key identifier.
 * @param identifier - The section.key identifier of the setting to retrieve.
 */
export const useSetting = (identifier: string) => useSelector((state: RootState) =>
  createSelector(
    [selectSettings],
    settings => {
      const { namespaceID, sectionID, settingID } = parseSettingIdentifier(identifier);
      return settings[namespaceID]?.sections[sectionID]?.settings[settingID].value;
    },
  )(state),
);

/**
* Retrieves multiple settings by their section.key identifiers. The return value is a map
* of the setting identifiers to the setting data. If a setting is not found, or denied access,
* it will have a value of `undefined`.
*/
export const useSettings = (identifiers: string[]) => useSelector((state: RootState) =>
  createSelector(
    [selectSettings],
    settings => {
      const settingMap = {} as Record<string, any>;
      identifiers.forEach(identifier => {
        const { namespaceID, sectionID, settingID } = parseSettingIdentifier(identifier);
        settingMap[identifier] = settings[namespaceID]?.sections[sectionID]?.settings[settingID];
      });
      return settingMap;
    },
  )(state),
);
