import { EmptyState } from '@omniviewdev/base-ui';
import type { DrawerComponent } from '@omniviewdev/runtime';
import { LuUnplug } from 'react-icons/lu';

type Props = {
  /** The opaque resource type ID the drawer was opened for, if the host knows it. */
  resourceKey: string;
  /** The plugin whose drawer or sidebar contribution is gone. */
  pluginId: string;
};

const DrawerUnavailable = ({ resourceKey, pluginId }: Props) => (
  <EmptyState
    role='status'
    size='md'
    icon={<LuUnplug size={28} />}
    title='Unavailable'
    description={`${resourceKey ? `The ${resourceKey} view` : 'This view'} came from the "${pluginId}" plugin, which is no longer loaded or was reloaded. Close this drawer and open the resource again.`}
  />
);

/**
 * The host-owned drawer shown in place of one whose plugin contribution was unloaded or
 * replaced. It references nothing the plugin supplied (not its title, icon, views or actions),
 * so replacing an open drawer with it releases every retired plugin component. The drawer
 * header keeps its own close button.
 */
export function createUnavailableDrawer(props: Props): DrawerComponent {
  return {
    title: props.resourceKey || 'Unavailable',
    icon: <LuUnplug />,
    views: [{
      title: 'Unavailable',
      icon: <LuUnplug />,
      component: () => <DrawerUnavailable {...props} />,
    }],
    actions: [],
  };
}
