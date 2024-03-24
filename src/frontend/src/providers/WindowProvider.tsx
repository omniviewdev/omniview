import { WindowContext } from '@/contexts/WindowContext';
import { useWindow } from '@/hooks/useWindow';
import { type ReactNode } from 'react';

export const WindowProvider = ({ children }: { children: ReactNode }) => {
  const window = useWindow();

  return (
    <WindowContext.Provider value={window}>
      {children}
    </WindowContext.Provider>
  );
};
