import { describe, expect, test } from 'vitest';
import {
  canAttemptServiceReuse,
  createServicePlan,
  getBuildSteps,
  isGatewayModeRequested,
  requireGatewayWorkspace,
  validateReusableServiceResponse,
} from './global-setup';

describe('E2E global setup planning', () => {
  test('does not require the sibling gateway repo for local-only runs', () => {
    expect(isGatewayModeRequested({ TEST_MODES: 'local' })).toBe(false);
    expect(getBuildSteps({ TEST_MODES: 'local' }).map(step => step.name)).toEqual([
      'shared build',
      'server build',
    ]);

    const services = createServicePlan({ TEST_MODES: 'local' });

    expect(services.map(service => service.name)).toEqual(['Server', 'Desktop']);
    expect(services.find(service => service.name === 'Server')?.env).not.toHaveProperty(
      'GATEWAY_URL'
    );
  });

  test('requires the sibling gateway repo only when gateway coverage is requested', () => {
    expect(isGatewayModeRequested({ TEST_MODES: 'gateway' })).toBe(true);
    expect(getBuildSteps({ TEST_MODES: 'gateway' }).map(step => step.name)).toEqual([
      'shared build',
      'gateway build',
      'server build',
    ]);

    const services = createServicePlan({ TEST_MODES: 'gateway', E2E_SKIP_DESKTOP: '1' });

    expect(services.map(service => service.name)).toEqual(['Gateway', 'Server']);
    expect(services.find(service => service.name === 'Server')?.env).toHaveProperty(
      'GATEWAY_URL',
      'ws://localhost:3320'
    );
  });

  test('fails with an explicit diagnostic when requested gateway workspace is missing', () => {
    expect(() => requireGatewayWorkspace('/tmp/zclaudia-gateway-does-not-exist')).toThrow(
      'TEST_MODES includes gateway'
    );
  });

  test('validates reusable local server and desktop service identities', () => {
    expect(
      validateReusableServiceResponse('Server', {
        status: 200,
        body: JSON.stringify({
          success: true,
          data: { version: '1.1.0', features: ['projects'] },
        }),
        contentType: 'application/json',
      })
    ).toBe(true);
    expect(
      validateReusableServiceResponse('Server', {
        status: 200,
        body: '<html>not the server</html>',
        contentType: 'text/html',
      })
    ).toBe(false);

    expect(
      validateReusableServiceResponse('Desktop', {
        status: 200,
        body: '<!doctype html><html><head><title>ZClaudia</title></head><div id="root"></div>',
        contentType: 'text/html',
      })
    ).toBe(true);
    expect(
      validateReusableServiceResponse('Desktop', {
        status: 200,
        body: '<title>Other App</title>',
        contentType: 'text/html',
      })
    ).toBe(false);
  });

  test('does not reuse services that lack an identity probe', () => {
    const [gateway] = createServicePlan({ TEST_MODES: 'gateway', E2E_SKIP_DESKTOP: '1' });
    const [server] = createServicePlan({ TEST_MODES: 'local', E2E_SKIP_DESKTOP: '1' });

    expect(gateway.name).toBe('Gateway');
    expect(canAttemptServiceReuse(gateway)).toBe(false);
    expect(server.name).toBe('Server');
    expect(canAttemptServiceReuse(server)).toBe(true);
  });
});
