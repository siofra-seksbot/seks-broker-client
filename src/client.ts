import type {
  BrokerConfig,
  Logger,
  ChannelTokens,
  AgentCapabilities,
  BrokerProxyRequestOptions,
  BrokerAuthVerifyResponse,
  HealthCheckResult,
  BrokerEndpoint,
} from './types.js';
import {
  BrokerUnreachableError,
  BrokerAuthFailedError,
  SecretNotFoundError,
  BrokerClientError,
} from './types.js';
import { validateConfig, normalizeUrl } from './config.js';
import { TokenResolver } from './token.js';
import { FailoverManager } from './failover.js';

/**
 * HTTP Agent with keep-alive for connection pooling
 */
const httpAgent = new (await import('http')).Agent({
  keepAlive: true,
  maxSockets: 10,
});

/**
 * HTTPS Agent with keep-alive for connection pooling
 */
const httpsAgent = new (await import('https')).Agent({
  keepAlive: true,
  maxSockets: 10,
});

/**
 * Default logger that does nothing
 */
const defaultLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

/**
 * Main SEKS Broker Client
 * 
 * Provides access to broker APIs with automatic failover, token resolution,
 * and connection pooling.
 */
export class BrokerClient {
  private tokenResolver: TokenResolver;
  private failoverManager: FailoverManager;
  private logger: Logger;

  constructor(
    private config: BrokerConfig,
    logger?: Logger
  ) {
    validateConfig(config);
    this.logger = logger || defaultLogger;
    this.tokenResolver = new TokenResolver(this.logger);
    this.failoverManager = new FailoverManager(config, this.tokenResolver, this.logger);
    
    this.logger.info('BrokerClient initialized', {
      primary: config.primary.url,
      hasSecondary: !!config.secondary,
    });
  }

  /**
   * Resolve the agent's auth token for the broker
   */
  async resolveToken(): Promise<string> {
    const endpoint = this.failoverManager.getActiveEndpoint();
    return this.tokenResolver.resolveToken(endpoint);
  }

  /**
   * Get channel tokens (Discord, Telegram, etc.) for this agent
   */
  async getChannelTokens(): Promise<ChannelTokens> {
    return this.failoverManager.executeWithFailover(async (endpoint, token) => {
      const response = await this.request(endpoint, token, '/v1/tokens/channels');
      return response.json() as Promise<ChannelTokens>;
    });
  }

  /**
   * Get a specific secret field from a provider
   */
  async getSecret(provider: string, field: string): Promise<string> {
    try {
      const response = await this.failoverManager.executeWithFailover(async (endpoint, token) => {
        return this.request(endpoint, token, `/v1/secrets/${provider}/${field}`);
      });

      const data = await response.json() as { value?: unknown };
      if (typeof data.value === 'string') {
        return data.value;
      }
      
      throw new SecretNotFoundError(provider, field);
    } catch (error) {
      if (error instanceof BrokerClientError) {
        throw error;
      }
      
      // Convert HTTP 404 to SecretNotFoundError
      if (this.isHttpError(error, 404)) {
        throw new SecretNotFoundError(provider, field, error);
      }
      
      throw error;
    }
  }

  /**
   * List capabilities for this agent
   */
  async listCapabilities(): Promise<AgentCapabilities> {
    return this.failoverManager.executeWithFailover(async (endpoint, token) => {
      const response = await this.request(endpoint, token, '/v1/agent/capabilities');
      return response.json() as Promise<AgentCapabilities>;
    });
  }

  /**
   * Make a proxied request to a provider API through the broker
   * The broker will inject appropriate credentials
   */
  async proxyRequest(
    provider: string,
    path: string,
    options: BrokerProxyRequestOptions = {}
  ): Promise<Response> {
    // Remove leading slash from path if present
    const cleanPath = path.startsWith('/') ? path.slice(1) : path;
    const proxyPath = `/v1/proxy/${provider}/${cleanPath}`;

    return this.failoverManager.executeWithFailover(async (endpoint, token) => {
      const requestOptions: RequestInit = {
        method: options.method || 'GET',
        headers: options.headers || {},
      };
      
      if (options.body !== undefined) {
        requestOptions.body = options.body;
      }
      
      return this.request(endpoint, token, proxyPath, requestOptions);
    });
  }

  /**
   * Perform a health check / ping
   */
  async ping(): Promise<HealthCheckResult> {
    const endpoint = this.failoverManager.getActiveEndpoint();
    const endpointName = this.failoverManager.getActiveEndpointName();
    
    return this.failoverManager.healthCheck(endpoint, endpointName);
  }

  /**
   * Verify the current agent token
   */
  async verifyToken(): Promise<BrokerAuthVerifyResponse> {
    return this.failoverManager.executeWithFailover(async (endpoint, token) => {
      const response = await this.request(endpoint, token, '/v1/auth/verify', {
        method: 'POST',
        body: JSON.stringify({ token }),
      });
      return response.json() as Promise<BrokerAuthVerifyResponse>;
    });
  }

  /**
   * Get client status and configuration
   */
  getStatus(): {
    activeEndpoint: 'primary' | 'secondary';
    primaryUrl: string;
    secondaryUrl?: string;
    cacheStats: ReturnType<TokenResolver['getCacheStats']>;
  } {
    const result: {
      activeEndpoint: 'primary' | 'secondary';
      primaryUrl: string;
      secondaryUrl?: string;
      cacheStats: ReturnType<TokenResolver['getCacheStats']>;
    } = {
      activeEndpoint: this.failoverManager.getActiveEndpointName(),
      primaryUrl: this.config.primary.url,
      cacheStats: this.tokenResolver.getCacheStats(),
    };
    
    if (this.config.secondary?.url) {
      result.secondaryUrl = this.config.secondary.url;
    }
    
    return result;
  }

  /**
   * Clear all cached tokens
   */
  clearTokenCache(): void {
    this.tokenResolver.clearAllTokenCache();
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    this.failoverManager.destroy();
    this.tokenResolver.cleanupExpiredTokens();
  }

  /**
   * Make an HTTP request to a broker endpoint
   */
  private async request(
    endpoint: BrokerEndpoint,
    token: string,
    path: string,
    options: RequestInit = {}
  ): Promise<Response> {
    const url = `${normalizeUrl(endpoint.url)}${path}`;
    const isHttps = url.startsWith('https:');
    
    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          ...options.headers,
        },
        // Use appropriate agent for connection pooling
        // @ts-expect-error - Node.js fetch supports agent option
        agent: isHttps ? httpsAgent : httpAgent,
        signal: AbortSignal.timeout(this.config.timeoutMs || 30000),
      });

      // Check for auth errors
      if (response.status === 401 || response.status === 403) {
        throw new BrokerAuthFailedError(
          `Authentication failed: ${response.status} ${response.statusText}`,
          response.status
        );
      }
      
      // Check for other errors
      if (!response.ok) {
        const error = new Error(`HTTP ${response.status}: ${response.statusText}`);
        (error as any).statusCode = response.status;
        throw error;
      }

      return response;
    } catch (error) {
      // Convert network errors to BrokerUnreachableError
      if (this.isNetworkError(error)) {
        throw new BrokerUnreachableError(
          `Broker unreachable: ${error}`,
          endpoint.url,
          error
        );
      }
      
      throw error;
    }
  }

  /**
   * Check if error is a network/connection error
   */
  private isNetworkError(error: unknown): boolean {
    if (!error || typeof error !== 'object') {
      return false;
    }
    
    const errorObj = error as { code?: string; name?: string };
    
    // Common network error codes
    const networkErrorCodes = [
      'ECONNREFUSED',
      'ENOTFOUND',
      'ETIMEDOUT',
      'ECONNRESET',
      'EHOSTUNREACH',
      'ENETUNREACH',
    ];
    
    return networkErrorCodes.includes(errorObj.code || '') ||
           errorObj.name === 'AbortError' ||
           errorObj.name === 'TimeoutError';
  }

  /**
   * Check if error is an HTTP error with specific status code
   */
  private isHttpError(error: unknown, statusCode: number): boolean {
    if (error instanceof BrokerAuthFailedError) {
      return error.statusCode === statusCode;
    }
    
    return false;
  }
}