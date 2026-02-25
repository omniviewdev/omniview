import React from 'react';
import { OperationsContext } from '../../context/operations/OperationsContext';

export const useOperations = () => {
  const context = React.useContext(OperationsContext);
  if (!context) throw new Error('useOperations must be used within an OperationsProvider');
  return context;
};
