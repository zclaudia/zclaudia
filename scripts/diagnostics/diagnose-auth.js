#!/usr/bin/env node

// Diagnose authentication and data-loading problems.

console.log('=== ZClaudia diagnostics ===\n');

async function diagnose() {
  const baseUrl = 'http://localhost:3100';

  // 1. Check server info
  console.log('1. Checking server info...');
  try {
    const infoRes = await fetch(`${baseUrl}/api/server/info`);
    const info = await infoRes.json();
    console.log('   ✅ Server Info:', JSON.stringify(info.data, null, 2));
  } catch (err) {
    console.log('   ❌ Server info check failed:', err.message);
    return;
  }

  // 2. Check API key
  console.log('\n2. Checking API key...');
  try {
    const keyRes = await fetch(`${baseUrl}/api/auth/key`);
    const keyData = await keyRes.json();
    if (keyData.success) {
      console.log('   ✅ API Key:', keyData.data.maskedKey);
      console.log('   Full key:', keyData.data.fullKey);

      const apiKey = keyData.data.fullKey;

      // 3. Verify the API key
      console.log('\n3. Verifying API key...');
      const verifyRes = await fetch(`${baseUrl}/api/auth/verify`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
      });
      if (verifyRes.ok) {
        console.log('   ✅ API key verified');
      } else {
        console.log('   ❌ API key verification failed:', verifyRes.status);
        return;
      }

      // 4. Test the projects API
      console.log('\n4. Testing projects API...');
      const projectsRes = await fetch(`${baseUrl}/api/projects`, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
      });
      const projectsData = await projectsRes.json();
      if (projectsData.success) {
        console.log(`   ✅ Projects: ${projectsData.data.length}`);
        projectsData.data.forEach(p => {
          console.log(`      - ${p.name} (${p.type})`);
        });
      } else {
        console.log('   ❌ Projects check failed:', projectsData.error);
      }

      // 5. Test the providers API
      console.log('\n5. Testing providers API...');
      const providersRes = await fetch(`${baseUrl}/api/providers`, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
      });
      const providersData = await providersRes.json();
      if (providersData.success) {
        console.log(`   ✅ Providers: ${providersData.data.length}`);
        providersData.data.forEach(p => {
          console.log(`      - ${p.name} (${p.type})${p.isDefault ? ' [default]' : ''}`);
        });
      } else {
        console.log('   ❌ Providers check failed:', providersData.error);
      }
    } else {
      console.log('   ❌ Could not fetch the API key:', keyData.error);
    }
  } catch (err) {
    console.log('   ❌ API key check failed:', err.message);
  }

  console.log('\n=== Diagnostics complete ===');
  console.log('\nSuggestions:');
  console.log('1. Open http://localhost:1420 in a browser');
  console.log('2. Open the developer tools console tab');
  console.log('3. Look for authentication-related errors');
  console.log('4. If an API key is shown, run the following in the console:');
  console.log(
    '   localStorage.setItem("zclaudia-servers", JSON.stringify({...JSON.parse(localStorage.getItem("zclaudia-servers")), state: {...JSON.parse(localStorage.getItem("zclaudia-servers")).state, servers: JSON.parse(localStorage.getItem("zclaudia-servers")).state.servers.map(s => s.name === "Local Server" ? {...s, apiKey: "<API_KEY>"} : s)}}))'
  );
}

diagnose().catch(console.error);
