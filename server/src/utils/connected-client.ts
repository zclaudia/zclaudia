import { type WebSocket } from 'ws';
import type { ServerMessage } from '@zclaudia/shared/wire/messages';

/**
 * WebSocket client shape used across every server layer (root server,
 * application transport, infra gateway virtual clients, domain ports).
 * Lives in utils so no layer has to import upwards for it;
 * application/conversation/transport/types.ts re-exports it for compatibility.
 */
export interface ConnectedClient {
  id: string;
  ws: WebSocket;
  isAlive: boolean;
  isLocal: boolean; // Whether this is a localhost connection
  authenticated: boolean; // Whether the client has been authenticated
  /**
   * Trusted desktop host (connected via `/ws/host` with a valid one-time
   * capability ticket). Only the upgrade path can set this — no client
   * message can self-promote to trusted host.
   */
  isTrustedHost?: boolean;
}

// Message sender interface for abstraction
export interface MessageSender {
  send: (message: ServerMessage) => void;
}

// Create a virtual client for Gateway-forwarded messages
export function createVirtualClient(clientId: string, sender: MessageSender): ConnectedClient {
  return {
    id: clientId,
    ws: {
      readyState: 1, // WebSocket.OPEN
      send: (data: string) => {
        const message = JSON.parse(data);
        sender.send(message);
      },
    } as WebSocket,
    isAlive: true,
    isLocal: false,
    authenticated: true,
  };
}
