import { Suspense, type ReactNode } from 'react';
import { ErrorBoundary } from '../../components/ErrorBoundary';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { ConnectionProvider } from '../../contexts/ConnectionContext';
import { ThemeProvider } from '../../contexts/ThemeContext';

export interface StandaloneConnectionProps {
  standaloneServerUrl?: string;
  standaloneServerId?: string;
  standaloneGatewayUrl?: string;
  standaloneGatewaySecret?: string;
}

export const LazyFallback = () => (
  <div className="flex items-center justify-center h-full">
    <div className="text-sm text-muted-foreground animate-pulse">Loading...</div>
  </div>
);

interface WindowShellProps {
  children: ReactNode;
  label?: string;
  withTheme?: boolean;
  connection?: true | StandaloneConnectionProps;
}

export function WindowShell({ children, label, withTheme = true, connection }: WindowShellProps) {
  // ConfirmDialog is a sibling of children (outside Suspense, inside every
  // provider) so the in-app confirm()/promptText() primitive works in this and
  // every popped-out standalone window.
  let content = (
    <>
      <Suspense fallback={<LazyFallback />}>{children}</Suspense>
      <ConfirmDialog />
    </>
  );

  if (connection) {
    const connectionProps = connection === true ? {} : connection;
    content = <ConnectionProvider {...connectionProps}>{content}</ConnectionProvider>;
  }

  if (label) {
    content = <ErrorBoundary label={label}>{content}</ErrorBoundary>;
  }

  if (withTheme) {
    content = <ThemeProvider defaultTheme="dark-neutral">{content}</ThemeProvider>;
  }

  return content;
}
