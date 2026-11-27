import { createContext } from 'react';
import type { ExtensionAuthority } from './extensionAuthority';

/** Host outlets only. Never pass this authority into a plugin contribution or its props. */
export const ExtensionAuthorityContext = createContext<ExtensionAuthority | null>(null);
