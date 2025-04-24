import React from 'react';
import { Link as OriginalLink, type LinkProps as OriginalLinkProps, useParams } from 'react-router-dom';

type LinkProps = {
  /** The path to link to */
  to: string;
  /** Navigate within the current context */
  withinContext?: boolean;
} & Omit<OriginalLinkProps, 'to'>;

/**
 * Renders a history-aware link to a route. If `withinContext` is true, the link is resolved
 * within the current context, appending the link to the current plugin and contextID path.
 * Otherwise, it navigates to the specified `to` path.
 *
 * If `withinContext` is true and the current contextID is not available, the link will be
 * resolved as if `withinContext` was false.
 *
 * @example
 * import { Link } from '@omniviewdev/runtime/router';
 *
 * <Link to="/servers" withinContext>Go to Servers</Link>
 * <Link to="/dashboard">Go to Dashboard</Link>
 */
const Link: React.FC<LinkProps> = ({ to, withinContext, ...props }) => {
  const { pluginId, connectionID } = useParams<{ pluginId: string; connectionID: string }>();

  if (!pluginId) {
    console.error('Link used outside of a plugin context');
  }

  if (!connectionID && withinContext) {
    console.error('Link used within a context without a connectionID');
  }

  const resolvedTo = Boolean(withinContext) && pluginId
    ? `/_plugin/${pluginId}/connection/${connectionID}${to.startsWith('/') ? '' : '/'}${to}`
    : `/_plugin/${pluginId}${to.startsWith('/') ? '' : '/'}${to}`;

  // Memoize the link, and default to not adding underline
  return React.useMemo(() => <OriginalLink style={{ textDecoration: 'none', color: 'inherit' }} {...props} to={resolvedTo} />, [props, resolvedTo]);
};

export default Link;
