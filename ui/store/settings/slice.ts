import { createSlice } from '@reduxjs/toolkit';
import type { PayloadAction } from '@reduxjs/toolkit';
import type { Setting, SettingsState } from './types';

import { initialState as appearanceInitialState } from './sections/appearance';
import { initialState as editorInitialState } from './sections/editor';
import { initialState as generalInitialState } from './sections/general';
import { initialState as notificationsInitialState } from './sections/notifications';
import { initialState as terminalInitialState } from './sections/terminal';
import { parseSettingIdentifier, validateSettingValue } from './helpers';
import { awsState, azureState, gcpState } from './sections/clouds';

const initialState: SettingsState = {
  core: {
    id: 'core',
    label: 'Core',
    description: 'Core settings namespace for the application',
    icon: 'LuSettings2',
    sections: {
      general: generalInitialState,
      appearance: appearanceInitialState,
      editor: editorInitialState,
      terminal: terminalInitialState,
      notifications: notificationsInitialState,
    },
  },
  clouds: {
    id: 'clouds',
    label: 'Clouds',
    description: 'Customize cloud provider settings',
    icon: 'LuCloud',
    sections: {
      aws: awsState,
      gcp: gcpState,
      azure: azureState,
    },
  },
  orchestrators: {
    id: 'orchestrators',
    label: 'Orchestrators',
    description: 'Customize orchestrator settings',
    icon: 'LuServer',
    sections: {
      kubernetes: {
        id: 'kubernetes',
        label: 'Kubernetes',
        description: 'Customize Kubernetes settings',
        icon: 'SiKubernetes',
        settings: {},
      },
      docker: {
        id: 'docker',
        label: 'Docker',
        description: 'Customize Docker settings',
        icon: 'SiDocker',
        settings: {},
      },
      openshift: {
        id: 'openshift',
        label: 'OpenShift',
        description: 'Customize OpenShift settings',
        icon: 'SiRedhatopenshift',
        settings: {},
      },
      mesos: {
        id: 'mesos',
        label: 'Mesos',
        description: 'Customize Mesos settings',
        icon: 'SiApache',
        settings: {},
      },
    },
  },
};

// Slice
export const slice = createSlice({
  name: 'settings',
  initialState,
  reducers: {
    /**
    * Sets a single value for a setting by it's unique identifier of the form `<namespace>.<sectionID>.<settingID>`,
    * and validates the value against the setting's type and options.
    *
    * @param state The current settings state
    * @param action The action with the setting identifier and value to set
    */
    setSettingValue(state, action: PayloadAction<{ identifier: string; value: any }>) {
      const { identifier, value } = action.payload;
      const { namespaceID, sectionID, settingID } = parseSettingIdentifier(identifier);

      // Attempt to find the setting
      // TODO - add the context check here
      const setting = state[namespaceID]?.sections[sectionID]?.settings[settingID];
      if (!setting) {
        throw new Error(`Attempted to set a setting value that does not exist: ${identifier}`);
      }

      // First, check the type
      const validationError = validateSettingValue(setting, value);
      if (validationError) {
        throw new Error(`Attempted to set a setting with an invalid value: ${validationError}`);
      }

      // Then, if they have a custom validator, run that as well
      const customValidatorError = setting.validator?.(value, state);
      if (customValidatorError) {
        throw new Error(`Attempted to set a setting with an invalid value: ${customValidatorError}`);
      }

      setting.value = value;
    },

    /**
     * Sets multiple values for settings at once, and validates each value against the setting's type and options.
     * If any setting value is invalid, the entire batch will be rejected.
     */
    batchSetSettingValues(state, action: PayloadAction<{ values: Record<string, any> }>) {
      const { values } = action.payload;
      const invalidValues: string[] = [];

      // Validate each setting value up front
      for (const identifier in values) {
        const { namespaceID, sectionID, settingID } = parseSettingIdentifier(identifier);
        const setting = state[namespaceID]?.sections[sectionID]?.settings[settingID];
        console.log(setting);
        if (!setting) {
          invalidValues.push(identifier);
          continue;
        }

        const validationError = validateSettingValue(setting as Setting, values[identifier]);
        if (validationError) {
          throw new Error(validationError);
        }
      }

      // If any values are invalid, reject the entire batch
      if (invalidValues.length > 0) {
        throw new Error(`Attempted to set invalid setting values: ${invalidValues.join(', ')}`);
      }

      // Set each value
      for (const identifier in values) {
        const { namespaceID, sectionID, settingID } = parseSettingIdentifier(identifier);
        state[namespaceID].sections[sectionID].settings[settingID].value = values[identifier];
      }
    },

    /**
     * Restores a setting to it's default value.
     */
    resetSettingValue(state, action: PayloadAction<{ identifier: string }>) {
      const { identifier } = action.payload;
      const { namespaceID, sectionID, settingID } = parseSettingIdentifier(identifier);

      // Attempt to find the setting
      const setting = state[namespaceID]?.sections[sectionID]?.settings[settingID];
      if (!setting) {
        throw new Error(`Attempted to reset a setting that does not exist: ${identifier}`);
      }

      state[namespaceID].sections[sectionID].settings[settingID].value = setting.default;
    },

    /**
     * Restores all settings to their default values.
     * This will reset all settings in the entire application, and this ability is restricted purely to
     * the core settings namespace.
     */
    resetAllSettings(state) {
      for (const sectionID in state.core.sections) {
        for (const settingID in state.core.sections[sectionID].settings) {
          state.core.sections[sectionID].settings[settingID].value = state.core.sections[sectionID].settings[settingID].default;
        }
      }
    },
  },
});

// Action creators are generated for each case reducer function
export const { setSettingValue, batchSetSettingValues, resetSettingValue, resetAllSettings } = slice.actions;

export default slice.reducer;
