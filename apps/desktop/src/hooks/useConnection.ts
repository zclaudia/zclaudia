import { useContext } from 'react';
import { ConnectionContext } from '../contexts/ConnectionContext';

/**
 * Hook to access the unified WebSocket connection.
 * Automatically handles both direct and gateway connection modes.
 */
export function useConnection() {
  const context = useContext(ConnectionContext);

  if (!context) {
    throw new Error('useConnection must be used within ConnectionProvider');
  }

  return context;
}
