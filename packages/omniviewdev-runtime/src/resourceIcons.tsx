import React, { Component, type ComponentType, type ReactNode } from 'react';
import { useExtensionPoint } from './extensions/provider';

export const RESOURCE_ICON_EXTENSION_POINT_ID = 'omniview/resource/icons';

export type ResourceIconProps = {
  size?: number;
  className?: string;
  'aria-hidden'?: boolean | 'true' | 'false';
};

/** Resource keys are opaque outside the contributing plugin. */
export type ResourceIconSetV1 = {
  schemaVersion: 1;
  resolve(resourceKey: string): ComponentType<ResourceIconProps> | undefined;
};

export type ResourceIconComponentProps = ResourceIconProps & {
  pluginId: string;
  resourceKey: string;
  fallback?: ReactNode;
};

class IconBoundary extends Component<{
  children: ReactNode;
  fallback: ReactNode;
  resetToken: unknown;
}, { failed: boolean; resetToken: unknown }> {
  state = { failed: false, resetToken: this.props.resetToken };
  static getDerivedStateFromProps(props: { resetToken: unknown }, state: { resetToken: unknown }) {
    return props.resetToken !== state.resetToken ? { failed: false, resetToken: props.resetToken } : null;
  }
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

/** Uses only sets registered by the requested plugin; registry mutations invalidate rendering. */
export function ResourceIcon({ pluginId, resourceKey, fallback, ...props }: ResourceIconComponentProps) {
  const store = useExtensionPoint<ResourceIconSetV1>(RESOURCE_ICON_EXTENSION_POINT_ID);
  const defaultFallback = fallback === undefined
    ? <svg width={props.size ?? 16} height={props.size ?? 16} viewBox="0 0 24 24" fill="none" stroke="currentColor" className={props.className} aria-hidden={props['aria-hidden'] ?? true}><path d="m12 3 9 5v8l-9 5-9-5V8l9-5Zm0 9 9-4M12 12 3 8m9 4v9" /></svg>
    : fallback;
  for (const contribution of store?.listAll() ?? []) {
    if (contribution.plugin !== pluginId) continue;
    try {
      const set = contribution.value;
      if (set?.schemaVersion !== 1 || typeof set.resolve !== 'function') continue;
      const Icon = set.resolve(resourceKey);
      if (!Icon) continue;
      return <IconBoundary key={JSON.stringify([pluginId, resourceKey, store?.version, contribution.id])} resetToken={contribution} fallback={defaultFallback}>
        <React.Suspense fallback={defaultFallback}>
          <Icon {...props} aria-hidden={props['aria-hidden'] ?? true} />
        </React.Suspense>
      </IconBoundary>;
    } catch {
      // A plugin resolver must not prevent other sets or the generic fallback from rendering.
    }
  }
  return <>{defaultFallback}</>;
}
