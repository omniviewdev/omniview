import React from 'react';

export type PortForwardContextObject = Record<string, unknown>;

// eslint-disable-next-line
export const PortForwardContext = React.createContext<PortForwardContextObject | undefined>(undefined);

if (import.meta.env.DEV) {
  PortForwardContext.displayName = 'PortForwardContext';
}
