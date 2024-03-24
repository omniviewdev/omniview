import { type Setting } from './types';

/**
 * Validate a setting value matches the desired type and options, and returns a reason if it does not.
 */
export const validateSettingValue = (setting: Setting, value: any) => {
  // Guards
  switch (setting.type) {
    case 'text': {
      if (typeof value !== 'string') {
        return 'Attempted to set a text setting with a value that is not a string.';
      }

      break;
    }

    case 'integer': {
      if (typeof value !== 'number' && !Number.isInteger(value)) {
        return 'Attempted to set an integer setting with a value that is not an integer.';
      }

      break;
    }

    case 'float': {
      if (typeof value !== 'number') {
        return 'Attempted to set a float setting with a value that is not a float.';
      }

      break;
    }

    case 'select': {
      if (!setting.options.map(option => option.value).includes(value)) {
        return 'Attempted to set a select setting with a value that is not an available option.';
      }

      break;
    }

    case 'toggle': {
      if (typeof value !== 'boolean') {
        return 'Attempted to set a toggle setting with a value that is not a boolean.';
      }

      break;
    }

    case 'color': {
      if (typeof value !== 'string' || !(/^#[0-9A-Fa-f]{6}$/.exec(value))) {
        return 'Attempted to set a color setting with a value that is not a valid hex color.';
      }

      break;
    }

    default: {
      return 'Attempted to set a setting with an unknown type.';
    }
  }

  return '';
};

/**
* Parses the string identifier from a <namespace>.<section>.<setting> string.
* @param identifier The identifier to parse
* @returns An object with the namespace, section, and setting keys.
*/
export const parseSettingIdentifier = (identifier: string) => {
  const [namespaceID, sectionID, settingID] = identifier.split('.');
  return { namespaceID, sectionID, settingID };
};

