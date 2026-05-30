/**
 * Gateway Backend 路由演示
 *
 * 这个测试文件演示了 Gateway 如何区分和路由到不同的 Backend
 */

import { describe, test, expect } from 'vitest';

describe('Gateway Backend 路由演示', () => {
  test('演示 HTTP API 路由机制', async () => {
    console.log('\n=== HTTP API 路由演示 ===\n');

    // 场景：同一个 Gateway (localhost:3200)，两个不同的 Backend

    // Backend A: laptop-001
    const backendA = {
      id: 'backend-laptop-001',
      apiKey: 'laptop-api-key',
      url: 'http://localhost:3200/api/proxy/backend-laptop-001/api/projects'
      //                                        ↑
      //                                        backendId 在 URL 路径中
    };

    // Backend B: desktop-002
    const backendB = {
      id: 'backend-desktop-002',
      apiKey: 'desktop-api-key',
      url: 'http://localhost:3200/api/proxy/backend-desktop-002/api/projects'
      //                                        ↑
      //                                        不同的 backendId
    };

    console.log('Backend A URL:', backendA.url);
    console.log('Backend B URL:', backendB.url);
    console.log('\nGateway 通过 URL 中的 backendId 区分请求应该路由到哪个 Backend');
    console.log('\n路径格式: /api/proxy/{backendId}{原始API路径}');
    console.log('          /api/proxy/backend-laptop-001/api/projects');
    console.log('                     ↑                  ↑');
    console.log('                     Backend ID         原始路径');
  });

  test('演示认证头格式', async () => {
    console.log('\n=== 认证机制演示 ===\n');

    const gatewaySecret = 'team-gateway-secret';  // 所有 Backend 共享

    // Backend A 的认证
    const backendAAuth = `Bearer ${gatewaySecret}:laptop-api-key`;
    console.log('Backend A 认证头:');
    console.log(`  Authorization: ${backendAAuth}`);
    console.log('  解析:');
    console.log('    - Gateway Secret: team-gateway-secret (Layer 1 - Gateway 认证)');
    console.log('    - Backend API Key: laptop-api-key (Layer 2 - Backend 认证)');

    // Backend B 的认证
    const backendBAuth = `Bearer ${gatewaySecret}:desktop-api-key`;
    console.log('\nBackend B 认证头:');
    console.log(`  Authorization: ${backendBAuth}`);
    console.log('  解析:');
    console.log('    - Gateway Secret: team-gateway-secret (相同)');
    console.log('    - Backend API Key: desktop-api-key (不同)');

    console.log('\n两层认证确保:');
    console.log('  ✓ Layer 1: 只有授权用户可以访问 Gateway');
    console.log('  ✓ Layer 2: 只有正确的 API Key 可以访问特定 Backend');
  });

  test('演示 WebSocket 消息格式', async () => {
    console.log('\n=== WebSocket 路由演示 ===\n');

    console.log('连接流程:');
    console.log('1. 客户端连接 Gateway WebSocket');
    console.log('   ws://localhost:3200/ws\n');

    console.log('2. 发送 Gateway 认证消息:');
    const gatewayAuthMsg = {
      type: 'gateway_auth',
      gatewaySecret: 'team-gateway-secret'
    };
    console.log('   ' + JSON.stringify(gatewayAuthMsg, null, 2).replace(/\n/g, '\n   '));

    console.log('\n3. Gateway 认证成功后，连接到特定 Backend:');
    const connectBackendMsg = {
      type: 'connect_backend',
      backendId: 'backend-laptop-001',  // ← 指定要连接的 Backend
      apiKey: 'laptop-api-key'
    };
    console.log('   ' + JSON.stringify(connectBackendMsg, null, 2).replace(/\n/g, '\n   '));

    console.log('\n4. 发送消息时，每次都包含 backendId:');
    const sendMsg = {
      type: 'send_to_backend',
      backendId: 'backend-laptop-001',  // ← 每次都要指定
      message: {
        type: 'create_session',
        projectId: 'proj-001'
      }
    };
    console.log('   ' + JSON.stringify(sendMsg, null, 2).replace(/\n/g, '\n   '));

    console.log('\nGateway 处理流程:');
    console.log('  1. 提取 backendId: "backend-laptop-001"');
    console.log('  2. 查找已注册的 Backend 连接');
    console.log('  3. 转发 message 内容到该 Backend');
    console.log('  4. Backend 处理请求并返回结果');
    console.log('  5. Gateway 转发结果给客户端');
  });

  test('演示 Backend 切换', async () => {
    console.log('\n=== Backend 切换演示 ===\n');

    console.log('初始状态: 连接到 Backend A (laptop-001)');
    console.log('当前 backendId: "backend-laptop-001"\n');

    console.log('发送消息到 Backend A:');
    const msgToA = {
      type: 'send_to_backend',
      backendId: 'backend-laptop-001',
      message: { type: 'get_sessions' }
    };
    console.log('  ' + JSON.stringify(msgToA, null, 2).replace(/\n/g, '\n  '));
    console.log('  → Gateway 路由到 Backend A');
    console.log('  ← 返回 Backend A 的会话列表\n');

    console.log('切换到 Backend B (desktop-002):');
    const switchMsg = {
      type: 'connect_backend',
      backendId: 'backend-desktop-002',  // ← 新的 Backend
      apiKey: 'desktop-api-key'
    };
    console.log('  ' + JSON.stringify(switchMsg, null, 2).replace(/\n/g, '\n  '));
    console.log('  → Gateway 断开与 Backend A 的代理');
    console.log('  → Gateway 连接到 Backend B\n');

    console.log('发送消息到 Backend B:');
    const msgToB = {
      type: 'send_to_backend',
      backendId: 'backend-desktop-002',  // ← 已更新
      message: { type: 'get_sessions' }
    };
    console.log('  ' + JSON.stringify(msgToB, null, 2).replace(/\n/g, '\n  '));
    console.log('  → Gateway 路由到 Backend B');
    console.log('  ← 返回 Backend B 的会话列表（与 A 完全不同）\n');

    console.log('关键点:');
    console.log('  ✓ 切换 Backend 只需更改 backendId 和 apiKey');
    console.log('  ✓ 数据完全隔离，Backend A 和 B 互不干扰');
    console.log('  ✓ Gateway 维护到多个 Backend 的连接');
  });

  test('演示 Gateway 内部状态', async () => {
    console.log('\n=== Gateway 内部状态演示 ===\n');

    console.log('Gateway 维护的 Backend 注册表:\n');

    const gatewayState = {
      backends: {
        'backend-laptop-001': {
          id: 'backend-laptop-001',
          status: 'online',
          apiKey: 'laptop-api-key',
          lastSeen: new Date('2026-02-03T10:00:00Z'),
          connection: 'WebSocket (connected)'
        },
        'backend-desktop-002': {
          id: 'backend-desktop-002',
          status: 'online',
          apiKey: 'desktop-api-key',
          lastSeen: new Date('2026-02-03T10:01:00Z'),
          connection: 'WebSocket (connected)'
        },
        'backend-cloud-003': {
          id: 'backend-cloud-003',
          status: 'offline',
          apiKey: 'cloud-api-key',
          lastSeen: new Date('2026-02-03T09:50:00Z'),
          connection: 'WebSocket (disconnected)'
        }
      }
    };

    console.log(JSON.stringify(gatewayState, null, 2));

    console.log('\n当客户端请求 Backend 时:');
    console.log('1. 提取 backendId (从 URL 或消息)');
    console.log('2. 查找注册表: backends[backendId]');
    console.log('3. 检查状态:');
    console.log('   - online: 转发请求');
    console.log('   - offline: 返回 502 Backend not available');
    console.log('   - not found: 返回 502 Backend not available');
  });

  test('演示错误场景', async () => {
    console.log('\n=== 错误场景演示 ===\n');

    console.log('场景 1: Backend 不存在');
    console.log('请求: GET /api/proxy/non-existent-backend/api/projects');
    console.log('响应:');
    const error1 = {
      error: 'Backend not available',
      backendId: 'non-existent-backend'
    };
    console.log('  ' + JSON.stringify(error1, null, 2).replace(/\n/g, '\n  '));
    console.log('  Status: 502 Bad Gateway\n');

    console.log('场景 2: Backend 离线');
    console.log('请求: GET /api/proxy/backend-offline/api/projects');
    console.log('响应:');
    const error2 = {
      error: 'Backend is offline',
      backendId: 'backend-offline',
      status: 'offline'
    };
    console.log('  ' + JSON.stringify(error2, null, 2).replace(/\n/g, '\n  '));
    console.log('  Status: 502 Bad Gateway\n');

    console.log('场景 3: Gateway Secret 错误');
    console.log('请求: Authorization: Bearer wrong-secret:laptop-api-key');
    console.log('响应:');
    const error3 = {
      error: 'Invalid gateway secret'
    };
    console.log('  ' + JSON.stringify(error3, null, 2).replace(/\n/g, '\n  '));
    console.log('  Status: 401 Unauthorized\n');

    console.log('场景 4: Backend API Key 错误');
    console.log('请求: Authorization: Bearer gateway-secret:wrong-api-key');
    console.log('响应:');
    const error4 = {
      error: 'Invalid backend API key'
    };
    console.log('  ' + JSON.stringify(error4, null, 2).replace(/\n/g, '\n  '));
    console.log('  Status: 401 Unauthorized\n');
  });

  test('完整流程总结', async () => {
    console.log('\n=== 完整流程总结 ===\n');

    console.log('HTTP API 请求流程:');
    console.log('┌─────────────────────────────────────────────────────────────┐');
    console.log('│ 客户端                                                       │');
    console.log('│ GET /api/proxy/backend-laptop-001/api/projects             │');
    console.log('│ Authorization: Bearer gateway-secret:laptop-api-key         │');
    console.log('└──────────────────────┬──────────────────────────────────────┘');
    console.log('                       │');
    console.log('                       ▼');
    console.log('┌─────────────────────────────────────────────────────────────┐');
    console.log('│ Gateway (localhost:3200)                                     │');
    console.log('│ 1. 解析 URL: backendId = "backend-laptop-001"              │');
    console.log('│ 2. 验证 Gateway Secret (Layer 1)                            │');
    console.log('│ 3. 查找 Backend 连接                                        │');
    console.log('│ 4. 验证 Backend API Key (Layer 2)                           │');
    console.log('└──────────────────────┬──────────────────────────────────────┘');
    console.log('                       │');
    console.log('                       ▼');
    console.log('┌─────────────────────────────────────────────────────────────┐');
    console.log('│ Backend A (laptop-001)                                      │');
    console.log('│ 处理请求: GET /api/projects                                 │');
    console.log('│ 返回结果                                                     │');
    console.log('└─────────────────────────────────────────────────────────────┘');

    console.log('\n\nWebSocket 消息流程:');
    console.log('┌─────────────────────────────────────────────────────────────┐');
    console.log('│ 客户端                                                       │');
    console.log('│ { type: "send_to_backend",                                  │');
    console.log('│   backendId: "backend-laptop-001",                          │');
    console.log('│   message: {...} }                                          │');
    console.log('└──────────────────────┬──────────────────────────────────────┘');
    console.log('                       │');
    console.log('                       ▼');
    console.log('┌─────────────────────────────────────────────────────────────┐');
    console.log('│ Gateway (localhost:3200)                                     │');
    console.log('│ 1. 提取 backendId: "backend-laptop-001"                    │');
    console.log('│ 2. 查找注册表                                               │');
    console.log('│ 3. 检查 Backend 状态: online                                │');
    console.log('│ 4. 转发 message 到 Backend                                  │');
    console.log('└──────────────────────┬──────────────────────────────────────┘');
    console.log('                       │');
    console.log('                       ▼');
    console.log('┌─────────────────────────────────────────────────────────────┐');
    console.log('│ Backend A (laptop-001)                                      │');
    console.log('│ 处理消息并返回结果                                           │');
    console.log('└─────────────────────────────────────────────────────────────┘');

    console.log('\n\n关键点:');
    console.log('✓ HTTP: 通过 URL 路径中的 :backendId 区分');
    console.log('✓ WebSocket: 通过消息中的 backendId 字段区分');
    console.log('✓ 认证: 两层认证（Gateway Secret + Backend API Key）');
    console.log('✓ 数据隔离: 每个 Backend 完全独立');
    console.log('✓ 切换简单: 只需更改 backendId 和 apiKey');
  });
});
