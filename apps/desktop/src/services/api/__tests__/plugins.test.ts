import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useServerStore } from '../../../stores/serverStore';
import { useGatewayStore } from '../../../stores/gatewayStore';
import { setPluginActive, fetchPluginDirs, savePluginDirs } from '../plugins';

// Exercises the real fetchApi/getAuthHeaders pipeline (no mocking of the api
// layer) so these tests prove the plugin API functions actually attach
// gateway auth headers, matching the pattern used in
// features/attachments/__tests__/api.test.ts.
describe('plugins api - gateway auth headers', () => {
  beforeEach(() => {
    useServerStore.setState({ activeServerId: 'backend-1', localServerPort: null });
    useGatewayStore.setState({
      gatewayUrl: 'gateway.example.com',
      gatewaySecret: 'secret-token',
      directGatewayUrl: 'gateway.example.com',
      directGatewaySecret: 'secret-token',
    });
  });

  function stubFetch(responseBody: unknown) {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      json: () => Promise.resolve(responseBody),
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  it('setPluginActive sends the Authorization header on activate', async () => {
    const fetchMock = stubFetch({ success: true, data: { activated: true } });

    await setPluginActive('com.example.plugin', 'activate');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      'http://gateway.example.com/api/proxy/backend-1/api/plugins/com.example.plugin/activate'
    );
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer secret-token' });
  });

  it('setPluginActive sends the Authorization header on deactivate', async () => {
    const fetchMock = stubFetch({ success: true, data: { deactivated: true } });

    await setPluginActive('com.example.plugin', 'deactivate');

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers).toMatchObject({ Authorization: 'Bearer secret-token' });
  });

  it('fetchPluginDirs sends the Authorization header', async () => {
    const fetchMock = stubFetch({
      success: true,
      data: { dirs: ['/a'], extraDirs: [] },
    });

    const result = await fetchPluginDirs();

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://gateway.example.com/api/proxy/backend-1/api/plugins/dirs');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer secret-token' });
    expect(result).toEqual({ dirs: ['/a'], extraDirs: [] });
  });

  it('savePluginDirs sends the Authorization header and PUT body', async () => {
    const fetchMock = stubFetch({ success: true, data: { dirs: ['/a', '/b'] } });

    const result = await savePluginDirs(['/a', '/b']);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://gateway.example.com/api/proxy/backend-1/api/plugins/dirs');
    expect(init.method).toBe('PUT');
    expect(init.body).toBe(JSON.stringify({ dirs: ['/a', '/b'] }));
    expect(init.headers).toMatchObject({ Authorization: 'Bearer secret-token' });
    expect(result).toEqual({ dirs: ['/a', '/b'] });
  });

  it('setPluginActive rejects with the server error message on failure', async () => {
    stubFetch({ success: false, error: { message: 'Plugin not found' } });

    await expect(setPluginActive('missing', 'activate')).rejects.toThrow('Plugin not found');
  });
});
