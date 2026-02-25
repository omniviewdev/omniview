import React from 'react';

export type Operation = {
  id: string;
  label: string;
  resourceKey: string;
  resourceName: string;
  namespace: string;
  connectionID: string;
  status: 'running' | 'completed' | 'error';
  progress?: { ready: number; desired: number };
  message?: string;
  startedAt: number;
  completedAt?: number;
};

export type OperationsContextType = {
  operations: Operation[];
  addOperation: (op: Operation) => void;
  updateOperation: (id: string, updates: Partial<Operation>) => void;
  removeOperation: (id: string) => void;
};

export const OperationsContext = React.createContext<OperationsContextType | undefined>(undefined);

const AUTO_REMOVE_DELAY = 30_000;

export const OperationsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [operations, setOperations] = React.useState<Operation[]>([]);

  const addOperation = React.useCallback((op: Operation) => {
    setOperations((prev) => [op, ...prev]);
  }, []);

  const updateOperation = React.useCallback((id: string, updates: Partial<Operation>) => {
    setOperations((prev) =>
      prev.map((op) => (op.id === id ? { ...op, ...updates } : op)),
    );
  }, []);

  const removeOperation = React.useCallback((id: string) => {
    setOperations((prev) => prev.filter((op) => op.id !== id));
  }, []);

  // Auto-remove completed/errored operations after 30 seconds.
  React.useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (const op of operations) {
      if (op.status === 'completed' || op.status === 'error') {
        const elapsed = Date.now() - (op.completedAt ?? op.startedAt);
        const remaining = Math.max(0, AUTO_REMOVE_DELAY - elapsed);
        timers.push(setTimeout(() => removeOperation(op.id), remaining));
      }
    }
    return () => timers.forEach(clearTimeout);
  }, [operations, removeOperation]);

  const value = React.useMemo(
    () => ({ operations, addOperation, updateOperation, removeOperation }),
    [operations, addOperation, updateOperation, removeOperation],
  );

  return (
    <OperationsContext.Provider value={value}>
      {children}
    </OperationsContext.Provider>
  );
};
