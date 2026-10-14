import Icon from '@/components/icons/Icon';
import { Card, Chip, Text } from '@omniviewdev/base-ui';
import { useExtensionRegistry, type ExtensionPointStoreContract } from '@omniviewdev/runtime';
import React from 'react';
import styles from './ExtensionSettingsPage.module.css';

/** Subscribe to a CSS media query (replacement for MUI's `useMediaQuery`). */
const useMediaQuery = (query: string): boolean => {
  const getMatches = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(query).matches
    : false;
  const [matches, setMatches] = React.useState(getMatches);

  React.useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }

    const mql = window.matchMedia(query);
    const onChange = () => {
      setMatches(mql.matches);
    };

    onChange();
    mql.addEventListener('change', onChange);

    return () => {
      mql.removeEventListener('change', onChange);
    };
  }, [query]);

  return matches;
};

const ExtensionSettingsPage: React.FC = () => {
  const extensions = useExtensionRegistry();
  // MUI `lg` breakpoint
  const isNormalScreenSize = useMediaQuery('(min-width: 1200px)');

  const [selected, setSelected] = React.useState<ExtensionPointStoreContract | undefined>(undefined);

  const selectExtensionPoint = (id: string) => {
    const extension = extensions?.getExtensionPoint(id);

    if (extension) {
      setSelected(extension);
    }
  };

  return (
    <div className={styles.Root}>
      <div className={styles.Header}>
        <Icon name={'LuBrainCircuit'} size={isNormalScreenSize ? 20 : 30} />
        <div className={styles.HeaderText}>
          <Text weight='semibold' size={isNormalScreenSize ? 'lg' : 'md'}>
            Extension
          </Text>
          <Text size='xs'>
            View and manage the installed extensions in the IDE
          </Text>
        </div>
      </div>

      {/* Render the settings section here */}
      <div className={styles.Body}>

        <Card className={styles.PointsCard}>
          <div className={styles.PointsCardInner}>
            <Text size='xl' weight='semibold' className={styles.PointsTitle}>Extension Points</Text>
            <div className={styles.PointsList} role='list'>
              {extensions?.listExtensionPoints().map((extensionPointId) => (
                <div key={extensionPointId} role='listitem'>
                  <button
                    type='button'
                    className={styles.PointItem}
                    data-selected={selected?.id === extensionPointId}
                    onClick={() => {
                      selectExtensionPoint(extensionPointId);
                    }}
                  >
                    <Text size='sm'>{extensionPointId}</Text>
                  </button>
                </div>
              ))}
            </div>
          </div>
        </Card>

        {selected && (
          <div className={styles.Detail}>

            <Card className={styles.DetailCard}>
              <div className={styles.DetailCardInner}>
                <div className={styles.DetailRow}>
                  <div className={styles.DetailTitle}>
                    <Text weight='semibold'>
                      {selected.id}
                    </Text>
                    <Chip variant='outline' color='neutral' size='sm' className={styles.ModeChip}>
                      {`${selected.mode} display`}
                    </Chip>
                  </div>
                  {selected.pluginId &&
                    <Chip variant='soft' color='brand' size='sm'>{selected.pluginId}</Chip>
                  }
                </div>
              </div>
            </Card>
            <ExtensionPointDisplay extensionPoint={selected} />
          </div>
        )}
      </div>
    </div>
  );
};

type ExtensionPointDisplayProps = {
  extensionPoint: ExtensionPointStoreContract;
};

const ExtensionPointDisplay: React.FC<ExtensionPointDisplayProps> = ({ extensionPoint }) => {
  const registrations = extensionPoint.list();

  if (!registrations?.length) {
    return (
      <div className={styles.Empty}>
        <Text>No extensions have been registered for this extension point</Text>
      </div>
    );
  }

  return (
    <div className={styles.Registrations}>
    </div>
  );

};

export default ExtensionSettingsPage;
