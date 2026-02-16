import { exec } from 'child_process';
import { promisify } from 'util';
import type { BrokerEndpoint, Logger } from './types.js';
import { TokenResolutionError } from './types.js';

const execAsync = promisify(exec);

/**
 * Token cache entry
 */
interface TokenCacheEntry {
  token: string;
  timestamp: number;
  ttl: number;
}

/**
 * Token resolver handles static tokens and command-based tokens
 */
export class TokenResolver {
  private cache = new Map<string, TokenCacheEntry>();

  constructor(
    private logger?: Logger,
    private tokenCacheTtl: number = 300000 // 5 minutes default
  ) {}

  /**
   * Resolve token from endpoint configuration
   * Supports caching for command-based tokens
   */
  async resolveToken(endpoint: BrokerEndpoint, cacheKey?: string): Promise<string> {
    // Static token - no caching needed
    if (endpoint.token) {
      this.logger?.debug(`Using static token for endpoint`);
      return endpoint.token;
    }

    // Command-based token
    if (endpoint.tokenCommand) {
      const key = cacheKey || endpoint.tokenCommand;
      
      // Check cache first
      const cached = this.cache.get(key);
      if (cached && this.isCacheValid(cached)) {
        this.logger?.debug(`Using cached token for command: ${endpoint.tokenCommand}`);
        return cached.token;
      }

      // Execute command
      this.logger?.debug(`Executing token command: ${endpoint.tokenCommand}`);
      try {
        const { stdout, stderr } = await execAsync(endpoint.tokenCommand, {
          timeout: 10000, // 10 second timeout
          maxBuffer: 1024 * 1024, // 1MB max output
        });

        if (stderr) {
          this.logger?.warn(`Token command stderr: ${stderr.trim()}`);
        }

        const token = stdout.trim();
        if (!token) {
          throw new TokenResolutionError(
            'Token command returned empty output',
            endpoint.tokenCommand
          );
        }

        // Cache the token
        this.cache.set(key, {
          token,
          timestamp: Date.now(),
          ttl: this.tokenCacheTtl,
        });

        this.logger?.debug(`Successfully resolved token via command`);
        return token;
      } catch (error) {
        throw new TokenResolutionError(
          `Failed to execute token command: ${error}`,
          endpoint.tokenCommand,
          error
        );
      }
    }

    throw new TokenResolutionError(
      'Endpoint must have either token or tokenCommand'
    );
  }

  /**
   * Clear cached token for a specific endpoint
   */
  clearTokenCache(endpoint: BrokerEndpoint): void {
    if (endpoint.tokenCommand) {
      this.cache.delete(endpoint.tokenCommand);
      this.logger?.debug(`Cleared cached token for command: ${endpoint.tokenCommand}`);
    }
  }

  /**
   * Clear all cached tokens
   */
  clearAllTokenCache(): void {
    const size = this.cache.size;
    this.cache.clear();
    this.logger?.debug(`Cleared ${size} cached tokens`);
  }

  /**
   * Clean up expired tokens from cache
   */
  cleanupExpiredTokens(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [key, entry] of this.cache.entries()) {
      if (!this.isCacheValid(entry, now)) {
        this.cache.delete(key);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      this.logger?.debug(`Cleaned up ${cleaned} expired tokens`);
    }
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { size: number; entries: Array<{ key: string; age: number; valid: boolean }> } {
    const now = Date.now();
    const entries = Array.from(this.cache.entries()).map(([key, entry]) => ({
      key,
      age: now - entry.timestamp,
      valid: this.isCacheValid(entry, now),
    }));

    return {
      size: this.cache.size,
      entries,
    };
  }

  /**
   * Check if a cache entry is still valid
   */
  private isCacheValid(entry: TokenCacheEntry, now: number = Date.now()): boolean {
    return now - entry.timestamp < entry.ttl;
  }
}