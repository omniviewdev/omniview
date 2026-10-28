import { createContext } from 'react';
import { DrawerComponent, DrawerContext } from './types';
import type { AccessRoute, ResourceReference } from '../../resource/v2/domain';
import type { HostRecord } from '../../resource/v2/host';

export type ShowResourceSidebarParams = {
  pluginID: string;
  targetId: string;
  route: AccessRoute;
  reference: ResourceReference;
  representation: string;
  /** An observed row opens directly; linked navigation performs a fresh Get. */
  record?: HostRecord;
  resourceName?: string;
  validateData?: (data: unknown) => boolean;
  signal?: AbortSignal;
};

export interface RightDrawerContextType {
  openDrawer: (component: DrawerComponent, ctx: DrawerContext) => void;
  closeDrawer: () => void;
  showResourceSidebar: (params: ShowResourceSidebarParams) => Promise<void>;
  isOpen: boolean;
}

export const RightDrawerContext = createContext<RightDrawerContextType | undefined>(undefined);
