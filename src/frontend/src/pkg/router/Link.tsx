import React from 'react';
import { Link as OriginalLink, LinkProps as OriginalLinkProps, useLocation, useParams } from 'react-router-dom';

interface LinkProps extends Omit<OriginalLinkProps, 'to'> {
  /** The path to link to */
  to: string;
  /** Navigate within the current context */
  withinContext?: boolean;
}

/**
 * Renders a history-aware link to a route. If `withinContext` is true, the link is resolved
 * within the current context, appending the link to the current plugin and contextID path.
 * Otherwise, it navigates to the specified `to` path.
 *
 * If `withinContext` is true and the current contextID is not available, the link will be
 * resolved as if `withinContext` was false.
 *
 * @example
 * import { Link } from '@infraview/router';
 *
 * <Link to="/servers" withinContext>Go to Servers</Link>
 * <Link to="/dashboard">Go to Dashboard</Link>
 */
const Link: React.FC<LinkProps> = ({ to, withinContext, ...props }) => {
  const location = useLocation()
  const plugin = location.pathname.split('/')[1]

  const { contextID } = useParams<{ contextID: string }>();

  const resolvedTo = !!withinContext && contextID
    ? `/${plugin}/${contextID}${to.startsWith('/') ? '' : '/'}${to}`
    : `/${plugin}${to.startsWith('/') ? '' : '/'}${to}`;

  // memoize the above pease!
  return React.useMemo(() => <OriginalLink {...props} to={resolvedTo} />, [props, resolvedTo]);
};

export default Link;
