import { SocksProxyAgent } from 'socks-proxy-agent';

export interface GatewayProxyConfig {
  proxyUrl?: string;
  proxyAuth?: {
    username: string;
    password: string;
  };
}

interface GatewayProxyAgentOptions {
  failureMessage: string;
  logger?: Pick<Console, 'error'>;
}

export function createSocksProxyAgent(
  config: GatewayProxyConfig,
  options: GatewayProxyAgentOptions
): SocksProxyAgent | undefined {
  if (!config.proxyUrl) return undefined;

  const logger = options.logger ?? console;

  try {
    let proxyUrl = config.proxyUrl;
    if (config.proxyAuth) {
      const url = new URL(proxyUrl);
      url.username = config.proxyAuth.username;
      url.password = config.proxyAuth.password;
      proxyUrl = url.toString();
    }

    return new SocksProxyAgent(proxyUrl);
  } catch (error) {
    logger.error(options.failureMessage, error);
    return undefined;
  }
}
