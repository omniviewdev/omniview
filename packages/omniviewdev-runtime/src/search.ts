import type { ComponentType } from 'react';
import type { AccessRoute, ReadTarget, ResourceReference } from './resource/v2/domain';

/** Resource scopes carry host-admitted canonical targets, never native lookup tuples. */
export type SearchScopeV1 =
  | {
    kind: 'connection';
    pluginId: string;
    connectionId: string;
    label: string;
  }
  | {
    kind: 'resource-type';
    pluginId: string;
    target: ReadTarget;
    targetId: string;
    label: string;
    /** Display label only; never part of native lookup identity. */
    scopeLabel?: string;
  }
  | {
    kind: 'resource';
    pluginId: string;
    reference: ResourceReference;
    route: AccessRoute;
    representation: string;
    targetId: string;
    label: string;
    scopeLabel?: string;
  };

/** Stable provider-owned action ID. `query` carries literal search text, not arbitrary action parameters. */
export type SearchActionReferenceV1 = {
  id: string;
  target: SearchScopeV1;
  query?: string;
  /** Permit connection recovery without dropping resource or resource-type scopes. */
  recovery?: 'connection';
};
export type SearchExecutionContextV1 = {
  signal: AbortSignal;
  generation: number;
  openResource(target: Extract<SearchScopeV1, { kind: 'resource' }>): Promise<void>;
  navigate(target: NavigationTargetV1): void;
};
export type SearchProviderStatusV1 = 'ready' | 'disconnected' | 'connecting' | 'authentication-required' | 'forbidden' | 'unavailable' | 'partial';

export type AvailabilityV1 = { state: 'enabled' } | { state: 'disabled'; reason: string };

export type SettingTargetV1 =
  | { section: 'core'; categoryId: string; settingId?: string }
  | { section: 'plugins'; pluginId: string; settingId?: string }
  | { section: 'extensions' };

export type NavigationTargetV1 =
  | { kind: 'core'; path: '/' | '/plugins' }
  | { kind: 'plugin'; pluginId: string; path: string };

export type HostCommandV1 = { kind: 'reload-connections'; pluginId: string };

export type SearchEntryV1 = {
  schemaVersion: 1;
  description?: string;
  keywords?: readonly string[];
  availability?: AvailabilityV1;
  scope?: SearchScopeV1;
} & (
  | { kind: 'command'; command: HostCommandV1 }
  | { kind: 'setting'; target: SettingTargetV1 }
  | { kind: 'navigation'; target: NavigationTargetV1 }
  | { kind: 'action'; action: SearchActionReferenceV1 }
);

export type SearchProviderItemV1 = {
  id: string;
  label: string;
  value: SearchEntryV1;
};

export type SearchProviderResponseV1 = {
  items: readonly SearchProviderItemV1[];
  completion: 'complete' | 'truncated';
  status?: SearchProviderStatusV1;
  message?: string;
};

export type SearchProviderRequestV1 = {
  query: string;
  signal: AbortSignal;
  limit: number;
  scopes: readonly SearchScopeV1[];
  generation: number;
};

export type SearchProviderV1 = {
  schemaVersion: 1;
  kind: 'provider';
  /** Headless action/dialog root. Receives the owner's plugin context; memo and lazy components work. */
  Context?: ComponentType;
  connectionTarget?: (connectionID: string) => NavigationTargetV1;
  /** Pure synchronous routing before bounded scheduling. Return false for unsupported scope depths. */
  supportsScope?: (scopes: readonly SearchScopeV1[]) => boolean;
  /** Defaults to host. `connectionTarget` changes navigation, not recovery ownership. */
  connectionRecovery?: 'host' | 'provider';
  /** Optional provider-specific validation after the host's canonical Get. */
  validateResource?: (target: Extract<SearchScopeV1, { kind: 'resource' }>, data: unknown) => boolean;
  /** Cancellable, side-effect-free discovery. Respect limit and report partial/truncated results honestly. */
  search(request: SearchProviderRequestV1): Promise<SearchProviderResponseV1>;
  /** Revalidate native identity and permissions here; the host never confirms destructive actions for plugins. */
  executeAction?: (action: SearchActionReferenceV1, context: SearchExecutionContextV1) => Promise<void | { keepOpen: true }>;
  validateAction?: (action: SearchActionReferenceV1, context: SearchExecutionContextV1) => Promise<boolean>;
};

/** Action references are executable only as responses from their owning provider. */
export type GlobalSearchContributionV1 = Exclude<SearchEntryV1, { kind: 'action' }> | SearchProviderV1;

/** Plugin-relative route data supplied by the host, without provider-specific parameter assumptions. */
export type SearchRouteContextV1 = {
  pluginId: string;
  params: Readonly<Record<string, string | undefined>>;
  pathname: string;
  search: string;
};

/** Attach to React Router's route `handle`. Only connections seed automatic scope; null explicitly opts out. */
export type SearchRouteHandleV1 = {
  searchScope?: Extract<SearchScopeV1, { kind: 'connection' }> | null | ((context: SearchRouteContextV1) => Extract<SearchScopeV1, { kind: 'connection' }> | null | undefined);
};

/** Host-owned event; plugins request search without installing global key listeners. */
export const GLOBAL_SEARCH_OPEN_EVENT = 'omniview/global-search/open';
/** Omitted scope follows the active route context; null explicitly searches everywhere. */
export type OpenGlobalSearchOptions = { scope?: SearchScopeV1 | null };

export function openGlobalSearch(options: OpenGlobalSearchOptions = {}): void {
  window.dispatchEvent(new CustomEvent<OpenGlobalSearchOptions>(GLOBAL_SEARCH_OPEN_EVENT, { detail: options }));
}
