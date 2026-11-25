import { ToolHeader, useMenu } from '@omniviewdev/kit';
import styles from './ToolHeader.examples.module.css';

const noop = () => undefined;

export const TitleOnly = () => <ToolHeader label="Connections" title="Connections" />;

/** A command and a menu. The buttons show when the pointer or the focus is in the header. */
export const WithActions = () => (
  <ToolHeader
    label="Connections"
    title="Connections"
    actions={[
      { id: 'refresh', label: 'Refresh connections', icon: 'refresh', onSelect: noop },
      { id: 'more', label: 'More connection actions', icon: 'ellipsis', menu: 'unregistered-menu' },
    ]}
  />
);

/** A command that is unavailable keeps its button, focusable, and says why. */
export const DisabledAction = () => (
  <ToolHeader label="Connections" title="Connections" actions={[{ id: 'refresh', label: 'Refresh connections', icon: 'refresh', onSelect: noop, disabledReason: 'Connections are loading.' }]} />
);

/** The title gives way with an ellipsis; the actions keep their width. */
export const LongTitle = () => (
  <div className={styles.narrow}>
    <ToolHeader
      label="Connections"
      title="Connections of the production workspace"
      actions={[
        { id: 'refresh', label: 'Refresh connections', icon: 'refresh', onSelect: noop },
        { id: 'more', label: 'More connection actions', icon: 'ellipsis', menu: 'unregistered-menu' },
      ]}
    />
  </div>
);

/** A menu action: the owning view registers the menu once with `useMenu` and passes its ID; the window's one `MenuHost` renders it. */
export const MenuAction = () => {
  const menu = useMenu(() => [
    { kind: 'action', id: 'new-folder', label: 'New folder', onSelect: noop },
    { kind: 'action', id: 'organize', label: 'Organize connections', onSelect: noop },
  ]);
  return <ToolHeader label="Connections" title="Connections" actions={[{ id: 'more', label: 'Organize connections', icon: 'ellipsis', menu }]} />;
};
