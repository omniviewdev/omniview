import React from 'react';
import { Link as OriginalLink, type LinkProps as OriginalLinkProps } from 'react-router';
import { usePluginContext } from '../context';
import { WindowActionsContext } from '../context/windows/WindowActionsContext';

type LinkProps = {
  /** The path to link to */
  to: string;
  /** Navigate within the current context */
  withinContext?: boolean;
} & Omit<OriginalLinkProps, 'to'>;

const MIDDLE_BUTTON = 1;

/**
 * Renders a history-aware link to a route. If `withinContext` is true, the link is resolved
 * within the current context, appending the link to the current plugin and contextID path.
 * Otherwise, it navigates to the specified `to` path.
 *
 * If `withinContext` is true and the current contextID is not available, the link will be
 * resolved as if `withinContext` was false.
 *
 * Inside a workspace window, Ctrl/Cmd+click and middle-click open the route in
 * a new background page tab.
 *
 * @example
 * import { Link } from '@omniviewdev/runtime/router';
 *
 * <Link to="/servers" withinContext>Go to Servers</Link>
 * <Link to="/dashboard">Go to Dashboard</Link>
 */
const Link: React.FC<LinkProps> = ({ to, withinContext, onClick, onAuxClick, ...props }) => {
  const { pluginId } = usePluginContext();
  // Optional: a link rendered outside a workspace window has no tabs to open.
  const windowActions = React.useContext(WindowActionsContext);

  if (!pluginId) {
    console.error('Link used outside of a plugin context');
  }

  const resolvedTo = `/_plugin/${pluginId}${to.startsWith('/') ? '' : '/'}${to}`;

  const handleClick = (event: React.MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (event.defaultPrevented || !windowActions || !(event.ctrlKey || event.metaKey)) {
      return;
    }

    event.preventDefault();
    windowActions.openInNewTab(resolvedTo, { background: true });
  };

  const handleAuxClick = (event: React.MouseEvent<HTMLAnchorElement>) => {
    onAuxClick?.(event);
    if (event.defaultPrevented || !windowActions || event.button !== MIDDLE_BUTTON) {
      return;
    }

    event.preventDefault();
    windowActions.openInNewTab(resolvedTo, { background: true });
  };

  return (
    <OriginalLink
      style={{ textDecoration: 'none', color: 'inherit' }}
      {...props}
      to={resolvedTo}
      onClick={handleClick}
      onAuxClick={handleAuxClick}
    />
  );
};

export default Link;
