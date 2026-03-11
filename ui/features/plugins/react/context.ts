import { createContext } from 'react';
import type { PluginService } from '../core/PluginService';

/**
 * React context holding the single PluginService instance.
 * Only PluginServiceProvider should set this value.
 */
export const PluginServiceContext = createContext<PluginService | null>(null);
