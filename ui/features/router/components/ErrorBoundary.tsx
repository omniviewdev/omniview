import React from 'react';
import { ErrorBoundary, FallbackProps } from 'react-error-boundary';
import { useRouteError } from 'react-router-dom';

function ErrorFallback({ error, resetErrorBoundary }: FallbackProps) {
  return (
    <div role="alert">
      <p>Something went wrong:</p>
      <pre>{error.message}</pre>
      <button onClick={resetErrorBoundary}>Try again</button>
    </div>
  );
}

export default function ErrorB({ children }: { children: React.ReactNode }) {
  return (
    <ErrorBoundary FallbackComponent={ErrorFallback}>
      {children}
    </ErrorBoundary>
  );
}

export function RouterErrorBoundary() {
  const error = useRouteError()
  console.error(error);
  return (
    <ErrorBoundary FallbackComponent={ErrorFallback} />
  );
}
