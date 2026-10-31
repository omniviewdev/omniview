import React, {
  useState, useCallback, type ReactNode, useMemo,
  useRef,
} from 'react';

// material-ui

// context
import {
  type DrawerComponent,
  type DrawerContext,
  RightDrawerContext,
  type RightDrawerContextType,
  type ShowResourceSidebarParams,
  ConnectionBoundary,
  ConnectionBoundaryFallback,
  withConnectionReady,
  useSnackbar,
} from '@omniviewdev/runtime';
import { ResourceClient } from '@omniviewdev/runtime/api';
import { jsonToValue, valueToJSON, resourceQueryKeys, createErrorHandler, type HostRecord, type Value } from '@omniviewdev/runtime';
import { useQueryClient } from '@tanstack/react-query';
import RightDrawer from '@/components/displays/RightDrawer';
import { bottomDrawerChannel, getBottomDrawerHeight } from './BottomDrawer/events';
import { createLinkedResourceDrawer } from '@/federation/LinkedResourceDrawer';
import { useExtensionPoint } from '@omniviewdev/runtime';
import { RESOURCE_DRAWER_EXTENSION_POINT_ID } from '@/features/extensions/drawer/extensionPoint';
import { RESOURCE_SIDEBAR_EXTENSION_POINT_ID } from '@/features/extensions/sidebar/extensionPoint';
import { createResourceExtensionRenderContext } from '@/features/extensions/resource/context';
import type { DrawerFactory as PluginDrawerFactory } from '@/features/plugins/core/types';
import type { SidebarComponent } from '@/features/plugins/core/types';
import type { ResourceExtensionRenderContext } from '@/features/plugins/core/types';
import handleStyles from '@/components/base/ResizeHandle.module.css';
import styles from './RightDrawerProvider.module.css';

type Props = {
  children: ReactNode;
};


/** Length of the core layout sidebar */
const innerWidthBuffer = 47;

const RightDrawerProvider: React.FC<Props> = ({ children }) => {
  const queryClient = useQueryClient();
  // TODO - calculate these based on window width
  const minWidth = 600;
  const maxWidth = window.innerWidth - innerWidthBuffer;
  const initialWidth = 800;

  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [content, setContent] = useState<DrawerComponent | null>(null);
  const [context, setContext] = useState<DrawerContext | undefined>(undefined);
  const resourceRequest = useRef(0);
  const cancelResourceRead = useRef<(() => void) | null>(null);
  const { showSnackbar } = useSnackbar();
  React.useEffect(() => () => {
    resourceRequest.current += 1;
    cancelResourceRead.current?.();
    cancelResourceRead.current = null;
  }, []);


  // Extension point hooks for plugin sidebar/drawer resolution
  const drawerEP = useExtensionPoint<PluginDrawerFactory, ResourceExtensionRenderContext>(
    RESOURCE_DRAWER_EXTENSION_POINT_ID,
  );
  const sidebarEP = useExtensionPoint<SidebarComponent, ResourceExtensionRenderContext>(
    RESOURCE_SIDEBAR_EXTENSION_POINT_ID,
  );
  const [isDragging, setIsDragging] = useState(false);

  const sidebarRef = useRef<HTMLDivElement>(null);
  const dragHandleRef = useRef<HTMLDivElement>(null);


  // The drawer's height rule reads --BottomDrawer-height; keep it on this element
  // rather than <html> so a bottom drawer toggle only restyles this subtree.
  React.useEffect(() => {
    const setHeightVar = (height: number) => {
      sidebarRef.current?.style.setProperty('--BottomDrawer-height', `${height}px`);
    };

    setHeightVar(getBottomDrawerHeight());
    return bottomDrawerChannel.on('onHeightChange', setHeightVar);
  }, []);

  React.useEffect(() => {
    const sizeReset = () => {
      if (!sidebarRef.current) {
        return;
      }

      // reset back to state level since the other container has set it
      sidebarRef.current.style.height = 'calc(100vh - var(--CoreLayoutHeader-height) - var(--CoreLayoutFooter-height) - var(--BottomDrawer-height, 32px))';
      sidebarRef.current.style.minHeight = 'calc(100vh - var(--CoreLayoutHeader-height) - var(--CoreLayoutFooter-height) - var(--BottomDrawer-height, 32px))';
      sidebarRef.current.style.maxHeight = 'calc(100vh - var(--CoreLayoutHeader-height) - var(--CoreLayoutFooter-height) - var(--BottomDrawer-height, 32px))';
    };

    const unsubscribeOnResizeDrawer = bottomDrawerChannel.on('onResizeHandler', (height) => {
      if (!sidebarRef.current) {
        return;
      }

      // more performant resizing while the resize handler is actually doing it's thing, otherwise we get cascading rerenders
      sidebarRef.current.style.height = `calc(100vh - var(--CoreLayoutHeader-height) - var(--CoreLayoutFooter-height) - ${height}px)`;
      sidebarRef.current.style.minHeight = `calc(100vh - var(--CoreLayoutHeader-height) - var(--CoreLayoutFooter-height) - ${height}px)`;
      sidebarRef.current.style.maxHeight = `calc(100vh - var(--CoreLayoutHeader-height) - var(--CoreLayoutFooter-height) - ${height}px)`;
    });

    const unsubsribeOnResizeReset = bottomDrawerChannel.on('onResizeReset', () => {
      sizeReset(); 
    });
    const unsubsribeOnFullscreen = bottomDrawerChannel.on('onFullscreen', () => {
      sizeReset(); 
    });
    const unsubsribeOnMinimize = bottomDrawerChannel.on('onMinimize', () => {
      sizeReset(); 
    });


    return () => {
      unsubscribeOnResizeDrawer();
      unsubsribeOnResizeReset();
      unsubsribeOnFullscreen();
      unsubsribeOnMinimize();
    };
  }, []);

  /**
   * Handle the double click separately from the drag to prevent shakiness
   */
  const handleClick = React.useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!sidebarRef.current) {
      return;
    }

    // if double click, reset height
    if (e.detail === 2) {
      // if already at initial width, set to max width
      if (sidebarRef.current.style.width === initialWidth + 'px') {
        sidebarRef.current.style.width = maxWidth + 'px';
      } else if (sidebarRef.current.style.width === maxWidth + 'px') {
        sidebarRef.current.style.width = initialWidth + 'px';
      } else {
        sidebarRef.current.style.width = initialWidth + 'px';
      }
    }
  }, [maxWidth]);

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    setIsDragging(true);
    e.preventDefault(); // Prevent text selection during drag
  }, []);

  // don't commit the width directly until mouse up, otherwise we'll suffer state sync
  // lag becoming visible
  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isDragging || !sidebarRef.current) {
      return;
    }

    // Calculate the remaining viewport width to the right of the mouse cursor in pixels
    const newWidth = window.innerWidth - e.clientX;

    // Clamp the width between min and max values
    if (newWidth < minWidth) {
      sidebarRef.current.style.width = minWidth + 'px';
      return;
    } else if (newWidth > maxWidth) {
      sidebarRef.current.style.width = maxWidth + 'px';
      return;
    }

    sidebarRef.current.style.width = newWidth + 'px';
  }, [isDragging, maxWidth]);

  // const handleMouseUp = useCallback(() => {
  //   setIsDragging(false);
  // }, []);

  React.useEffect(() => {
    const handleMouseUpGlobal = () => {
      setIsDragging(false);
    };

    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUpGlobal);
    } else {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUpGlobal);
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUpGlobal);
    };
  }, [isDragging, handleMouseMove]);


  /**
   * Close the resource drawer
   */
  const closeDrawer = useCallback(() => {
    const closedRequest = ++resourceRequest.current;
    cancelResourceRead.current?.();
    cancelResourceRead.current = null;
    setIsOpen(false);
    // clear the content after the drawer is closed
    setTimeout(() => {
      if (resourceRequest.current === closedRequest) {
        setContent(null);
      }
    }, 150);
  }, []);

  /**
   * Close the resource drawer on escape key press
   */
  const escFunction = useCallback((event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      if (!isOpen) {
        return;
      }

      event.preventDefault();
      closeDrawer();
    }
  }, [isOpen, closeDrawer]);

  React.useEffect(() => {
    document.addEventListener('keydown', escFunction, false);

    return () => {
      document.removeEventListener('keydown', escFunction, false);
    };
  }, [escFunction]);

  /**
   * Show the resource sidebar with a specific component.
   * The slide-in animation starts immediately; the heavy component tree
   * mounts as a low-priority transition so the browser can paint first.
   */
  const openDrawer: RightDrawerContextType['openDrawer'] = useCallback((DrawerComponent, ctx) => {
    resourceRequest.current += 1;
    cancelResourceRead.current?.();
    cancelResourceRead.current = null;
    setIsOpen(true);
    setContent(DrawerComponent);
    setContext(ctx);
  }, []);

  /**
   * Show a linked resource in the sidebar drawer.
   * Fetches data first, then opens the drawer with ctx.data — same flow as row clicks.
   */
  const showResourceSidebar = useCallback(async (params: ShowResourceSidebarParams) => {
    const request = ++resourceRequest.current;
    cancelResourceRead.current?.();
    cancelResourceRead.current = null;
    params.signal?.throwIfAborted();
    const resourceKey = params.reference.address.type;
    const resourceID = params.reference.address.id;
    const onSubmit = (ctx: DrawerContext, value: Record<string, any>, canonical?: Value) => {
      if (!ctx.resource) {
        throw new Error('Resource editor has no canonical target.');
      }

      void withConnectionReady(params.pluginID, ctx.resource.route.connection, async () => ResourceClient.Mutate(params.pluginID, {
        route: ctx.resource!.route,
        reference: ctx.resource!.reference,
        operation: 'update',
        input: canonical ?? jsonToValue(value),
      })).then(() => {
        void queryClient.invalidateQueries({ queryKey: resourceQueryKeys.all(params.pluginID) });
        closeDrawer();
      }).catch(createErrorHandler(showSnackbar, 'Failed to update resource'));
    };

    // Resolve drawer/sidebar via extension points — synchronous lookup
    const epContext = createResourceExtensionRenderContext(params.pluginID, resourceKey);
    const factory = drawerEP?.provide(epContext)?.[0];
    const sidebarComponent = sidebarEP?.provide(epContext)?.[0];

    // Prefer a full drawer factory from the plugin (same views + actions as table row clicks).
    // Fall back to the generic linked-resource drawer with sidebar component overlay.
    const drawer = factory
      ? factory(closeDrawer)
      : createLinkedResourceDrawer(
        resourceKey,
        onSubmit,
        closeDrawer,
        sidebarComponent,
      );

    // Observed rows already carry host identity. Linked resources require a fresh read.
    const result: HostRecord | null = params.record ?? await withConnectionReady(params.pluginID, params.route.connection, async () => {
      params.signal?.throwIfAborted();
      if (request !== resourceRequest.current) {
        throw new DOMException('Resource request superseded.', 'AbortError');
      }

      const read = ResourceClient.Get(params.pluginID, {
        targetId: params.targetId,
        request: {
          route: params.route,
          reference: params.reference,
          representation: params.representation,
        },
      });
      const cancel = () => {
        void read.cancel(); 
      };

      cancelResourceRead.current = cancel;
      params.signal?.addEventListener('abort', cancel, { once: true });
      try {
        params.signal?.throwIfAborted();
        return await read;
      } catch (error) {
        if (Boolean(params.signal?.aborted) || request !== resourceRequest.current) {
          throw new DOMException('Resource request cancelled.', 'AbortError');
        }

        throw error;
      } finally {
        params.signal?.removeEventListener('abort', cancel);
        if (cancelResourceRead.current === cancel) {
          cancelResourceRead.current = null;
        }
      }
    });

    params.signal?.throwIfAborted();
    if (request !== resourceRequest.current) {
      throw new DOMException('Resource request superseded.', 'AbortError');
    }

    if (!result) {
      throw new Error('Resource is no longer available.');
    }

    if (params.reference.incarnation && result.record.reference.incarnation !== params.reference.incarnation) {
      throw new Error('Resource identity changed. Search again.');
    }

    const data = valueToJSON(result.record.body);

    if (params.validateData && !params.validateData(data)) {
      throw new Error('Resource identity changed. Search again.');
    }

    openDrawer(drawer, {
      data,
      resource: {
        name: params.resourceName ?? resourceID,
        pluginID: params.pluginID,
        reference: result.record.reference,
        route: result.route,
        representation: result.record.representation.id,
        key: result.key,
        targetId: result.targetId,
        record: result,
      },
    });
  }, [closeDrawer, openDrawer, drawerEP, sidebarEP, queryClient, showSnackbar]);

  const contextValue = useMemo(() => ({
    closeDrawer,
    openDrawer,
    showResourceSidebar,
    isOpen,
  }), [openDrawer, closeDrawer, showResourceSidebar, isOpen]);

  return (
    <RightDrawerContext.Provider value={contextValue}>
      {children}
      <div
        ref={sidebarRef}
        className={styles.Drawer}
        data-open={isOpen || undefined}
        style={{ width: initialWidth }}
      >
        {content && (
          context?.resource?.pluginID && context.resource.route.connection ? (
            <ConnectionBoundary
              pluginID={context.resource.pluginID}
              connectionID={context.resource.route.connection}
              fallback={(state) => (
                <ConnectionBoundaryFallback
                  state={state}
                  connectionName={state.connection?.name?.trim() ? state.connection.name : context.resource?.route.connection}
                  onBack={closeDrawer}
                  backLabel="Close"
                />
              )}
            >
              <RightDrawer {...content} ctx={context} open={isOpen} onClose={closeDrawer} />
            </ConnectionBoundary>
          ) : (
            <RightDrawer {...content} ctx={context} open={isOpen} onClose={closeDrawer} />
          )
        )}
        <div
          ref={dragHandleRef}
          className={handleStyles.Left}
          data-dragging={isDragging || undefined}
          onMouseDown={handleMouseDown}
          onClick={handleClick}
        />
      </div>
    </RightDrawerContext.Provider>
  );
};

export default RightDrawerProvider;
