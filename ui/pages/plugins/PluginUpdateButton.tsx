import { useMemo } from 'react';
import { SplitButton } from '@omniviewdev/ui/menus';
import { Button } from '@omniviewdev/ui/buttons';
import { usePlugin } from '@/hooks/plugin/usePluginManager';

type Props = {
  pluginID: string;
  currentVersion?: string;
  installed?: boolean;
};

export default function PluginUpdateButton({ pluginID, currentVersion, installed }: Props) {
  const { versions, update } = usePlugin({ id: pluginID });

  const isLoading = versions.isLoading;
  const versionList = versions.data ?? [];
  const hasVersions = versionList.length > 0;
  const latestVersion = hasVersions ? versionList[0].version : '';
  const isLatest = installed && hasVersions && currentVersion === latestVersion;

  const options = useMemo(() => {
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
      <Button emphasis='soft' color='primary' size='sm' disabled>
        {isLoading ? 'Loading...' : 'Install'}
      </Button>
    );
  }

  // Already on latest — show a disabled "Updated" button (no dropdown needed)
  if (isLatest) {
    return (
      <Button emphasis='soft' color='primary' size='sm' disabled>
        Updated
      </Button>
    );
  }

  return (
    <SplitButton
      options={options}
      defaultIndex={options.findIndex((o) => o.key === latestVersion)}
      color='primary'
      emphasis='soft'
      size='sm'
      onSelect={(option) => update(option.key)}
    />
  );
}
