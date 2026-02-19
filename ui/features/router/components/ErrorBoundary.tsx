import React from 'react';
import { useRouteError } from 'react-router-dom';
import { FullPageErrorFallback } from '@/components/errors/ErrorFallback';
import log from '@/features/logger';

export function RouterErrorBoundary() {
  const error = useRouteError();
  const resolvedError = error instanceof Error ? error : new Error(String(error));

  React.useEffect(() => {
    console.error('[RouterErrorBoundary] route error caught:', resolvedError);
    log.error(resolvedError, { boundary: 'RouterErrorBoundary' });
  }, []);

  return (
    <FullPageErrorFallback
      error={resolvedError}
      resetErrorBoundary={() => window.location.reload()}
      boundary="Router"
    />
  );
}
