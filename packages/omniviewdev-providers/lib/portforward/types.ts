import React from 'react';

export interface PortForwardContextObject {}

export const PortForwardContext = React.createContext<PortForwardContextObject | null>(null);

if (import.meta.env.DEV) {
  PortForwardContext.displayName = "PortForwardContext"
}
