/* global confirm, location */
// localStorage is a Node 22+ global so the no-redeclare check sees it as
// already-defined; the rest are browser-only and stay declared here.
// Run this script in the browser console to quickly add a gateway server config.
// Usage:
//   1. Open http://localhost:1420
//   2. Open the developer tools console
//   3. Paste this script and press enter

(function addGatewayServer() {
  const STORAGE_KEY = 'zclaudia-servers';

  // Gateway configuration
  const GATEWAY_CONFIG = {
    name: 'Gateway Test',
    address: 'localhost:3200',
    gatewayUrl: 'ws://localhost:3200',
    gatewaySecret: 'test-secret-zclaudia-2026',
    // backendId: 'your-backend-id',  // uncomment and fill in if you know the backend id
    // apiKey: 'your-api-key'         // uncomment and fill in if the backend requires auth
  };

  try {
    // Read the current config
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      console.error('❌ Server config not found');
      return;
    }

    const data = JSON.parse(stored);

    // Check for an existing server with the same name
    const exists = data.state.servers.find(s => s.name === GATEWAY_CONFIG.name);
    if (exists) {
      console.log(`⚠️  Server "${GATEWAY_CONFIG.name}" already exists`);
      console.log('   Remove the old entry or rename it to re-add');
      return;
    }

    // Build the new server config
    const newServer = {
      id: `gateway-${Date.now()}`,
      name: GATEWAY_CONFIG.name,
      address: GATEWAY_CONFIG.address,
      isDefault: false,
      requiresAuth: true,
      connectionMode: 'gateway',
      gatewayUrl: GATEWAY_CONFIG.gatewayUrl,
      gatewaySecret: GATEWAY_CONFIG.gatewaySecret,
      createdAt: Date.now(),
    };

    // Optional fields
    if (GATEWAY_CONFIG.backendId) {
      newServer.backendId = GATEWAY_CONFIG.backendId;
    }
    if (GATEWAY_CONFIG.apiKey) {
      newServer.apiKey = GATEWAY_CONFIG.apiKey;
    }

    // Append to the server list
    data.state.servers.push(newServer);

    // Save
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));

    console.log('✅ Gateway server added!');
    console.log('📋 Server config:');
    console.log('   Name:', newServer.name);
    console.log('   Address:', newServer.address);
    console.log('   Gateway URL:', newServer.gatewayUrl);
    console.log('   Connection mode:', newServer.connectionMode);
    console.log('');
    console.log('🔄 Reload the page to apply the config');
    console.log('');

    // Offer an immediate reload
    if (confirm('Reload the page now to apply the new config?')) {
      location.reload();
    }
  } catch (error) {
    console.error('❌ Failed to add the server:', error);
  }
})();
