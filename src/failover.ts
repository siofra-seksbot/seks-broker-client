import type { BrokerConfig, BrokerEndpoint, HealthCheckResult, Logger } from './types.js';
import { BrokerUnreachableError, BrokerAuthFailedError } from './types.js';
import { TokenResolver } from './token.js';
import { normalizeUrl } from './config.js';

/**
 * Determines if an error should trigger failover to secondary endpoint
 */
export function shouldFailover(error: unknown, statusCode?: number): boolean {
  // Network errors - always failover
  if (error instanceof BrokerUnreachableError) {
    return true;
  }

  // HTTP status codes
  if (statusCode !== undefined) {
    // Auth errors - try secondary immediately (primary token may be revoked)
    if (statusCode === 401 || statusCode === 403) {
      return true;
    }
    
    // Server errors - failover
    if (statusCode >= 500) {
      return true;
    }
    
    // Client errors (except auth) - don't failover
    if (statusCode >= 400) {
      return false;
    }
  }

  return false;
}

/**
 * Calculates retry delay with exponential backoff
 */
export function calculateBackoffDelay(attempt: number, baseDelayMs: number = 1000): number {
  return Math.min(baseDelayMs * Math.pow(2, attempt - 1), 30000); // Cap at 30 seconds
}

/**
 * Manages failover between primary and secondary endpoints
 */
export class FailoverManager {
  private activeEndpoint: 'primary' | 'secondary' = 'primary';
  private lastFailoverTime = 0;
  private healthCheckTimer?: NodeJS.Timeout;
  private primaryHealthy = true;

  constructor(
    private config: BrokerConfig,
    private tokenResolver: TokenResolver,
    private logger?: Logger
  ) {
    this.startHealthCheck();
  }

  /**
   * Get the currently active endpoint
   */
  getActiveEndpoint(): BrokerEndpoint {
    const endpoint = this.activeEndpoint === 'primary' 
      ? this.config.primary 
      : this.config.secondary;
    
    if (!endpoint) {
      throw new Error('No secondary endpoint configured');
    }
    
    return endpoint;
  }

  /**
   * Check if primary endpoint is healthy
   */
  isPrimaryHealthy(): boolean {
    return this.primaryHealthy;
  }

  /**
   * Get the current active endpoint name
   */
  getActiveEndpointName(): 'primary' | 'secondary' {
    return this.activeEndpoint;
  }

  /**
   * Attempt to execute a request with automatic failover
   */
  async executeWithFailover<T>(
    requestFn: (endpoint: BrokerEndpoint, token: string) => Promise<T>
  ): Promise<T> {
    let lastError: unknown;
    
    // Try primary first (or current active endpoint)
    const primaryEndpoint = this.getActiveEndpoint();
    try {
      const token = await this.tokenResolver.resolveToken(primaryEndpoint, `${this.activeEndpoint}_token`);
      const result = await requestFn(primaryEndpoint, token);
      
      // Success - mark as healthy if we were using primary
      if (this.activeEndpoint === 'primary') {
        this.primaryHealthy = true;
      }
      
      return result;
    } catch (error) {
      lastError = error;
      this.logger?.warn(`Request failed on ${this.activeEndpoint} endpoint:`, error);
      
      // Determine if we should failover
      const statusCode = this.extractStatusCode(error);
      if (!shouldFailover(error, statusCode) || !this.config.secondary) {
        throw error;
      }
      
      // Clear token cache for failed endpoint
      this.tokenResolver.clearTokenCache(primaryEndpoint);
      
      // If we were using primary and have secondary, try to failover
      if (this.activeEndpoint === 'primary') {
        this.logger?.info('Failing over to secondary endpoint');
        this.activeEndpoint = 'secondary';
        this.lastFailoverTime = Date.now();
        this.primaryHealthy = false;
      }
    }

    // Retry with secondary endpoint if we failed over
    if (this.activeEndpoint === 'secondary' && this.config.secondary) {
      try {
        const token = await this.tokenResolver.resolveToken(this.config.secondary, 'secondary_token');
        const result = await requestFn(this.config.secondary, token);
        
        this.logger?.info('Successfully failed over to secondary endpoint');
        return result;
      } catch (error) {
        this.logger?.error('Request failed on secondary endpoint:', error);
        
        // Clear secondary token cache too
        this.tokenResolver.clearTokenCache(this.config.secondary);
        
        // Throw the original error if secondary also failed
        throw lastError;
      }
    }

    throw lastError;
  }

  /**
   * Perform health check on an endpoint
   */
  async healthCheck(endpoint: BrokerEndpoint, name: 'primary' | 'secondary'): Promise<HealthCheckResult> {
    const startTime = Date.now();
    
    try {
      const token = await this.tokenResolver.resolveToken(endpoint, `${name}_health_token`);
      const url = `${normalizeUrl(endpoint.url)}/v1/health`;
      
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        signal: AbortSignal.timeout(this.config.timeoutMs || 10000),
      });

      const responseTime = Date.now() - startTime;
      
      if (response.ok) {
        return {
          endpoint: name,
          healthy: true,
          responseTimeMs: responseTime,
        };
      } else {
        return {
          endpoint: name,
          healthy: false,
          responseTimeMs: responseTime,
          error: `HTTP ${response.status}`,
        };
      }
    } catch (error) {
      const responseTime = Date.now() - startTime;
      return {
        endpoint: name,
        healthy: false,
        responseTimeMs: responseTime,
        error: String(error),
      };
    }
  }

  /**
   * Try to restore primary endpoint if we failed over
   */
  async tryRestorePrimary(): Promise<boolean> {
    if (this.activeEndpoint === 'primary' || !this.config.secondary) {
      return false; // Already on primary or no secondary configured
    }

    // Don't try to restore too frequently
    const timeSinceFailover = Date.now() - this.lastFailoverTime;
    if (timeSinceFailover < (this.config.healthCheckIntervalMs || 60000)) {
      return false;
    }

    this.logger?.debug('Attempting to restore primary endpoint');
    
    const healthResult = await this.healthCheck(this.config.primary, 'primary');
    if (healthResult.healthy) {
      this.logger?.info('Restored primary endpoint');
      this.activeEndpoint = 'primary';
      this.primaryHealthy = true;
      return true;
    }

    return false;
  }

  /**
   * Start periodic health checks
   */
  private startHealthCheck(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
    }

    const interval = this.config.healthCheckIntervalMs || 60000;
    this.healthCheckTimer = setInterval(async () => {
      try {
        await this.tryRestorePrimary();
      } catch (error) {
        this.logger?.error('Health check failed:', error);
      }
    }, interval);
  }

  /**
   * Stop health checks
   */
  destroy(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = undefined;
    }
  }

  /**
   * Extract HTTP status code from error
   */
  private extractStatusCode(error: unknown): number | undefined {
    if (error instanceof BrokerAuthFailedError) {
      return error.statusCode;
    }
    
    // Try to extract from error message or other properties
    if (error && typeof error === 'object' && 'statusCode' in error) {
      return (error as { statusCode: number }).statusCode;
    }
    
    return undefined;
  }
}