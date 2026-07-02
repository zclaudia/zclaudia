import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSocksProxyAgent } from '../gateway-proxy-agent.js';

const { socksProxyAgentMock } = vi.hoisted(() => {
  function MockSocksProxyAgent(url: string): { proxyUrl: string } {
    return { proxyUrl: url };
  }

  return {
    socksProxyAgentMock: vi.fn(MockSocksProxyAgent),
  };
});

vi.mock('socks-proxy-agent', () => ({
  SocksProxyAgent: socksProxyAgentMock,
}));

describe('createSocksProxyAgent', () => {
  const logger = {
    error: vi.fn(),
  };

  beforeEach(() => {
    socksProxyAgentMock.mockClear();
    logger.error.mockClear();
  });

  it('returns undefined when no proxy URL is configured', () => {
    expect(createSocksProxyAgent({}, { logger, failureMessage: 'proxy failed' })).toBeUndefined();
    expect(socksProxyAgentMock).not.toHaveBeenCalled();
  });

  it('passes proxy URLs through to SocksProxyAgent', () => {
    const agent = createSocksProxyAgent(
      { proxyUrl: 'socks5://proxy.example.com:1080' },
      { logger, failureMessage: 'proxy failed' }
    );

    expect(socksProxyAgentMock).toHaveBeenCalledWith('socks5://proxy.example.com:1080');
    expect(agent).toEqual({ proxyUrl: 'socks5://proxy.example.com:1080' });
  });

  it('adds proxy authentication to the agent URL', () => {
    const agent = createSocksProxyAgent(
      {
        proxyUrl: 'socks5://proxy.example.com:1080',
        proxyAuth: {
          username: 'user',
          password: 'pass',
        },
      },
      { logger, failureMessage: 'proxy failed' }
    );

    expect(socksProxyAgentMock).toHaveBeenCalledWith('socks5://user:pass@proxy.example.com:1080');
    expect(agent).toEqual({ proxyUrl: 'socks5://user:pass@proxy.example.com:1080' });
  });

  it('logs and returns undefined when agent creation fails', () => {
    const error = new Error('bad proxy');
    function ThrowingSocksProxyAgent(): never {
      throw error;
    }
    socksProxyAgentMock.mockImplementationOnce(ThrowingSocksProxyAgent);

    expect(
      createSocksProxyAgent(
        { proxyUrl: 'socks5://proxy.example.com:1080' },
        { logger, failureMessage: 'proxy failed' }
      )
    ).toBeUndefined();

    expect(logger.error).toHaveBeenCalledWith('proxy failed', error);
  });
});
