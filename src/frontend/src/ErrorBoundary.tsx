import React from 'react';
import { ErrorBoundary } from 'react-error-boundary';
import { useRouteError } from 'react-router-dom';

function fallbackRender({ error }: { error: Error }) {
  console.log(error);

  return (
    <div role='alert'>
      <p>Something went wrong:</p>
      <pre style={{ color: 'red' }}>{error.message}</pre>
    </div>
  );
}

export default function EB({ children }: { children: React.ReactNode }) {
  return (
    <ErrorBoundary FallbackComponent={fallbackRender}>
      {children}
    </ErrorBoundary>
  );
}

export function RouterErrorBoundary() {
  const error = useRouteError() as Error | undefined;
  console.error(error);
  // Uncaught ReferenceError: path is not defined
  return (
    <div role='alert'>
      <p>Something went wrong:</p>
      <pre style={{ color: 'red' }}>{error?.message}</pre>
    </div>
  );
}
