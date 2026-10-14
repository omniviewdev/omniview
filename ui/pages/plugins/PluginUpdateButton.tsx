import { useMemo, useState } from 'react';
import { Button, Menu, SplitButton } from '@omniviewdev/base-ui';
import { usePlugin } from '@/hooks/plugin/usePluginManager';

type Props = {
  pluginID: string;
  currentVersion?: string;
  installed?: boolean;
};

type VersionOption = {
  key: string;
  label: string;
  disabled: boolean;
};

export default function PluginUpdateButton({ pluginID, currentVersion, installed }: Props) {
  const { versions, update } = usePlugin({ id: pluginID });

  const isLoading = versions.isLoading;
  const versionList = versions.data ?? [];
  const hasVersions = versionList.length > 0;
  const latestVersion = hasVersions ? versionList[0].version : '';
  const isLatest = installed && hasVersions && currentVersion === latestVersion;

  const options = useMemo<VersionOption[]>(() => {
    return [...versionList].reverse().map((v) => {
      let label = v.version;
      if (v.version === currentVersion) {
        label = `${v.version} (current)`;
      } else if (v.version === latestVersion) {
        label = installed ? `Update to ${v.version}` : `Install ${v.version}`;
      }

      return {
        key: v.version,
        label,
        disabled: v.version === currentVersion,
      };
    });
  }, [versionList, currentVersion, latestVersion, installed]);

  // No versions or still loading — show a simple disabled button
  if (isLoading || !hasVersions) {
    return (
      <Button variant='soft' color='brand' size='sm' disabled>
        {isLoading ? 'Loading...' : 'Install'}
      </Button>
    );
  }

  // Already on latest — show a disabled "Updated" button (no dropdown needed)
  if (isLatest) {
    return (
      <Button variant='soft' color='brand' size='sm' disabled>
        Updated
      </Button>
    );
  }

  return (
    <VersionSplitButton
      options={options}
      defaultIndex={options.findIndex((o) => o.key === latestVersion)}
      onSelect={(option) => {
        void update(option.key);
      }}
    />
  );
}

type VersionSplitButtonProps = {
  options: VersionOption[];
  defaultIndex: number;
  onSelect: (option: VersionOption) => void;
};

/**
 * Split button: the main action runs the selected version; the menu picks
 * (and immediately runs) another version.
 */
function VersionSplitButton({ options, defaultIndex, onSelect }: VersionSplitButtonProps) {
  const [selectedIndex, setSelectedIndex] = useState(defaultIndex);
  const selected = options[selectedIndex];

  return (
    <SplitButton variant='soft' color='brand' size='sm'>
      <SplitButton.Action
        disabled={!selected || selected.disabled}
        onClick={() => {
          if (selected && !selected.disabled) {
            onSelect(selected);
          }
        }}
      >
        {selected?.label}
      </SplitButton.Action>
      <SplitButton.Menu menuAriaLabel='Select option'>
        {options.map((option, index) => (
          <Menu.Item
            key={option.key}
            disabled={option.disabled}
            data-selected={index === selectedIndex ? 'true' : undefined}
            onClick={() => {
              setSelectedIndex(index);
              onSelect(option);
            }}
          >
            {option.label}
          </Menu.Item>
        ))}
      </SplitButton.Menu>
    </SplitButton>
  );
}
