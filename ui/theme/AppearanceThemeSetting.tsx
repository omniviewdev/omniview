import { useMemo } from 'react';
import { Select, useThemeList } from '@omniviewdev/base-ui';
import { LuChevronDown } from 'react-icons/lu';

import { useAppTheme } from './AppThemeController';

type ThemeOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

export default function AppearanceThemeSetting() {
  const themes = useThemeList();
  const { requestedThemeId, selectTheme } = useAppTheme();

  const options = useMemo<ThemeOption[]>(() => {
    const available: ThemeOption[] = [];
    let requestedAvailable = false;

    for (const theme of themes) {
      available.push({
        value: theme.id,
        label: theme.name,
      });
      requestedAvailable ||= theme.id === requestedThemeId;
    }

    if (!requestedAvailable) {
      available.push({
        value: requestedThemeId,
        label: `Unavailable: ${requestedThemeId}`,
        disabled: true,
      });
    }

    return available;
  }, [requestedThemeId, themes]);

  return (
    <Select.Root
      size='sm'
      value={requestedThemeId}
      items={options}
      onValueChange={(next) => {
        if (next !== null) {
          void selectTheme(next);
        }
      }}
    >
      <Select.Trigger aria-label='Theme'>
        <Select.Value />
        <Select.Icon>
          <LuChevronDown aria-hidden />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Positioner sideOffset={4}>
          <Select.Popup>
            <Select.List>
              {options.map(option => (
                <Select.Item
                  key={option.value}
                  value={option.value}
                  disabled={option.disabled}
                >
                  <Select.ItemText>{option.label}</Select.ItemText>
                </Select.Item>
              ))}
            </Select.List>
          </Select.Popup>
        </Select.Positioner>
      </Select.Portal>
    </Select.Root>
  );
}
