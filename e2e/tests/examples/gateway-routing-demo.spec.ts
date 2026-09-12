/**
 * Gateway backend routing demo
 *
 * This spec demonstrates how the gateway distinguishes and routes requests
 * to different backends.
 */

import { describe, test, expect } from 'vitest';

describe('Gateway backend routing demo', () => {
  test('demonstrates the HTTP API routing mechanism', async () => {
    console.log('\n=== HTTP API routing demo ===\n');

    // Scenario: one gateway (localhost:3200), two different backends.

    // Backend A: laptop-001
    const backendA = {
      id: 'backend-laptop-001',
      apiKey: 'laptop-api-key',
      url: 'http://localhost:3200/api/proxy/backend-laptop-001/api/projects',
      //                                        ↑
      //                                        backendId in the URL path
    };

    // Backend B: desktop-002
    const backendB = {
      id: 'backend-desktop-002',
      apiKey: 'desktop-api-key',
      url: 'http://localhost:3200/api/proxy/backend-desktop-002/api/projects',
      //                                        ↑
      //                                        a different backendId
    };

    console.log('Backend A URL:', backendA.url);
    console.log('Backend B URL:', backendB.url);
    console.log('\nThe gateway uses the backendId in the URL to decide which backend handles the request');
    console.log('\nPath format: /api/proxy/{backendId}{original API path}');
    console.log('          /api/proxy/backend-laptop-001/api/projects');
    console.log('                     ↑                  ↑');
    console.log('                     Backend ID         original path');
  });

  test('demonstrates the auth header format', async () => {
    console.log('\n=== Auth mechanism demo ===\n');

    const gatewaySecret = 'team-gateway-secret'; // shared by all backends

    // Backend A auth
    const backendAAuth = `Bearer ${gatewaySecret}:laptop-api-key`;
    console.log('Backend A auth header:');
    console.log(`  Authorization: ${backendAAuth}`);
    console.log('  Parsed:');
    console.log('    - Gateway secret: team-gateway-secret (layer 1 — gateway auth)');
    console.log('    - Backend API key: laptop-api-key (layer 2 — backend auth)');

    // Backend B auth
    const backendBAuth = `Bearer ${gatewaySecret}:desktop-api-key`;
    console.log('\nBackend B auth header:');
    console.log(`  Authorization: ${backendBAuth}`);
    console.log('  Parsed:');
    console.log('    - Gateway secret: team-gateway-secret (same)');
    console.log('    - Backend API key: desktop-api-key (different)');

    console.log('\nTwo-layer auth ensures:');
    console.log('  ✓ Layer 1: only authorized users can reach the gateway');
    console.log('  ✓ Layer 2: only the correct API key can reach a specific backend');
  });

  test('demonstrates the WebSocket message format', async () => {
    console.log('\n=== WebSocket routing demo ===\n');

    console.log('Connection flow:');
    console.log('1. The client connects to the gateway WebSocket');
    console.log('   ws://localhost:3200/ws\n');

    console.log('2. Send the gateway auth message:');
    const gatewayAuthMsg = {
      type: 'gateway_auth',
      gatewaySecret: 'team-gateway-secret',
    };
    console.log('   ' + JSON.stringify(gatewayAuthMsg, null, 2).replace(/\n/g, '\n   '));

    console.log('\n3. After gateway auth succeeds, connect to a specific backend:');
    const connectBackendMsg = {
      type: 'connect_backend',
      backendId: 'backend-laptop-001', // ← the backend to connect to
      apiKey: 'laptop-api-key',
    };
    console.log('   ' + JSON.stringify(connectBackendMsg, null, 2).replace(/\n/g, '\n   '));

    console.log('\n4. Every sent message includes the backendId:');
    const sendMsg = {
      type: 'send_to_backend',
      backendId: 'backend-laptop-001', // ← required on every message
      message: {
        type: 'create_session',
        projectId: 'proj-001',
      },
    };
    console.log('   ' + JSON.stringify(sendMsg, null, 2).replace(/\n/g, '\n   '));

    console.log('\nGateway processing flow:');
    console.log('  1. Extract the backendId: "backend-laptop-001"');
    console.log('  2. Look up the registered backend connection');
    console.log('  3. Forward the message payload to that backend');
    console.log('  4. The backend handles the request and returns the result');
    console.log('  5. The gateway forwards the result to the client');
  });

  test('demonstrates backend switching', async () => {
    console.log('\n=== Backend switch demo ===\n');

    console.log('Initial state: connected to backend A (laptop-001)');
    console.log('Current backendId: "backend-laptop-001"\n');

    console.log('Send a message to backend A:');
    const msgToA = {
      type: 'send_to_backend',
      backendId: 'backend-laptop-001',
      message: { type: 'get_sessions' },
    };
    console.log('  ' + JSON.stringify(msgToA, null, 2).replace(/\n/g, '\n  '));
    console.log('  → Gateway routes to backend A');
    console.log('  ← Returns the backend A session list\n');

    console.log('Switch to backend B (desktop-002):');
    const switchMsg = {
      type: 'connect_backend',
      backendId: 'backend-desktop-002', // ← the new backend
      apiKey: 'desktop-api-key',
    };
    console.log('  ' + JSON.stringify(switchMsg, null, 2).replace(/\n/g, '\n  '));
    console.log('  → Gateway disconnects the backend A proxy');
    console.log('  → Gateway connects to backend B\n');

    console.log('Send a message to backend B:');
    const msgToB = {
      type: 'send_to_backend',
      backendId: 'backend-desktop-002', // ← updated
      message: { type: 'get_sessions' },
    };
    console.log('  ' + JSON.stringify(msgToB, null, 2).replace(/\n/g, '\n  '));
    console.log('  → Gateway routes to backend B');
    console.log('  ← Returns the backend B session list (completely different from A)\n');

    console.log('Key points:');
    console.log('  ✓ Switching backends only changes backendId and apiKey');
    console.log('  ✓ Data is fully isolated — backends A and B never interfere');
    console.log('  ✓ The gateway maintains connections to multiple backends');
  });

  test('demonstrates gateway internal state', async () => {
    console.log('\n=== Gateway internal state demo ===\n');

    console.log('The backend registry maintained by the gateway:\n');

    const gatewayState = {
      backends: {
        'backend-laptop-001': {
          id: 'backend-laptop-001',
          status: 'online',
          apiKey: 'laptop-api-key',
          lastSeen: new Date('2026-02-03T10:00:00Z'),
          connection: 'WebSocket (connected)',
        },
        'backend-desktop-002': {
          id: 'backend-desktop-002',
          status: 'online',
          apiKey: 'desktop-api-key',
          lastSeen: new Date('2026-02-03T10:01:00Z'),
          connection: 'WebSocket (connected)',
        },
        'backend-cloud-003': {
          id: 'backend-cloud-003',
          status: 'offline',
          apiKey: 'cloud-api-key',
          lastSeen: new Date('2026-02-03T09:50:00Z'),
          connection: 'WebSocket (disconnected)',
        },
      },
    };

    console.log(JSON.stringify(gatewayState, null, 2));

    console.log('\nWhen a client requests a backend:');
    console.log('1. Extract the backendId (from the URL or the message)');
    console.log('2. Look it up in the registry: backends[backendId]');
    console.log('3. Check the status:');
    console.log('   - online: forward the request');
    console.log('   - offline: return 502 Backend not available');
    console.log('   - not found: return 502 Backend not available');
  });

  test('demonstrates error scenarios', async () => {
    console.log('\n=== Error scenario demo ===\n');

    console.log('Scenario 1: backend does not exist');
    console.log('Request: GET /api/proxy/non-existent-backend/api/projects');
    console.log('Response:');
    const error1 = {
      error: 'Backend not available',
      backendId: 'non-existent-backend',
    };
    console.log('  ' + JSON.stringify(error1, null, 2).replace(/\n/g, '\n  '));
    console.log('  Status: 502 Bad Gateway\n');

    console.log('Scenario 2: backend is offline');
    console.log('Request: GET /api/proxy/backend-offline/api/projects');
    console.log('Response:');
    const error2 = {
      error: 'Backend is offline',
      backendId: 'backend-offline',
      status: 'offline',
    };
    console.log('  ' + JSON.stringify(error2, null, 2).replace(/\n/g, '\n  '));
    console.log('  Status: 502 Bad Gateway\n');

    console.log('Scenario 3: wrong gateway secret');
    console.log('Request: Authorization: Bearer wrong-secret:laptop-api-key');
    console.log('Response:');
    const error3 = {
      error: 'Invalid gateway secret',
    };
    console.log('  ' + JSON.stringify(error3, null, 2).replace(/\n/g, '\n  '));
    console.log('  Status: 401 Unauthorized\n');

    console.log('Scenario 4: wrong backend API key');
    console.log('Request: Authorization: Bearer gateway-secret:wrong-api-key');
    console.log('Response:');
    const error4 = {
      error: 'Invalid backend API key',
    };
    console.log('  ' + JSON.stringify(error4, null, 2).replace(/\n/g, '\n  '));
    console.log('  Status: 401 Unauthorized\n');
  });

  test('full flow summary', async () => {
    console.log('\n=== Full flow summary ===\n');

    console.log('HTTP API request flow:');
    console.log('┌─────────────────────────────────────────────────────────────┐');
    console.log('│ Client                                                       │');
    console.log('│ GET /api/proxy/backend-laptop-001/api/projects              │');
    console.log('│ Authorization: Bearer gateway-secret:laptop-api-key          │');
    console.log('└──────────────────────┬──────────────────────────────────────┘');
    console.log('                       │');
    console.log('                       ▼');
    console.log('┌─────────────────────────────────────────────────────────────┐');
    console.log('│ Gateway (localhost:3200)                                     │');
    console.log('│ 1. Parse the URL: backendId = "backend-laptop-001"          │');
    console.log('│ 2. Verify the gateway secret (layer 1)                       │');
    console.log('│ 3. Look up the backend connection                            │');
    console.log('│ 4. Verify the backend API key (layer 2)                      │');
    console.log('└──────────────────────┬──────────────────────────────────────┘');
    console.log('                       │');
    console.log('                       ▼');
    console.log('┌─────────────────────────────────────────────────────────────┐');
    console.log('│ Backend A (laptop-001)                                       │');
    console.log('│ Handles the request: GET /api/projects                       │');
    console.log('│ Returns the result                                           │');
    console.log('└─────────────────────────────────────────────────────────────┘');

    console.log('\n\nWebSocket message flow:');
    console.log('┌─────────────────────────────────────────────────────────────┐');
    console.log('│ Client                                                       │');
    console.log('│ { type: "send_to_backend",                                   │');
    console.log('│   backendId: "backend-laptop-001",                           │');
    console.log('│   message: {...} }                                           │');
    console.log('└──────────────────────┬──────────────────────────────────────┘');
    console.log('                       │');
    console.log('                       ▼');
    console.log('┌─────────────────────────────────────────────────────────────┐');
    console.log('│ Gateway (localhost:3200)                                     │');
    console.log('│ 1. Extract the backendId: "backend-laptop-001"              │');
    console.log('│ 2. Look it up in the registry                                │');
    console.log('│ 3. Check the backend status: online                          │');
    console.log('│ 4. Forward the message to the backend                        │');
    console.log('└──────────────────────┬──────────────────────────────────────┘');
    console.log('                       │');
    console.log('                       ▼');
    console.log('┌─────────────────────────────────────────────────────────────┐');
    console.log('│ Backend A (laptop-001)                                       │');
    console.log('│ Handles the message and returns the result                   │');
    console.log('└─────────────────────────────────────────────────────────────┘');

    console.log('\n\nKey points:');
    console.log('✓ HTTP: distinguished by :backendId in the URL path');
    console.log('✓ WebSocket: distinguished by the backendId field in messages');
    console.log('✓ Auth: two layers (gateway secret + backend API key)');
    console.log('✓ Data isolation: every backend is fully independent');
    console.log('✓ Easy switching: only backendId and apiKey change');
  });
});
