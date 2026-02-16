import type { BrokerConfig, BrokerEndpoint } from './types.js';
import { ConfigValidationError } from './types.js';

/**
 * Validates a broker endpoint configuration
 */
export function validateEndpoint(endpoint: BrokerEndpoint, name: string): void {
  if (!endpoint.url) {
    throw new ConfigValidationError(`${name} endpoint must have a URL`);
  }

  try {
    new URL(endpoint.url);
  } catch {
    throw new ConfigValidationError(`${name} endpoint URL is invalid: ${endpoint.url}`);
  }

  if (!endpoint.token && !endpoint.tokenCommand) {
    throw new ConfigValidationError(
      `${name} endpoint must have either 'token' or 'tokenCommand'`
    );
  }

  if (endpoint.token && endpoint.tokenCommand) {
    throw new ConfigValidationError(
      `${name} endpoint cannot have both 'token' and 'tokenCommand'`
    );
  }
}

/**
 * Validates a complete broker configuration
 */
export function validateConfig(config: BrokerConfig): void {
  if (!config.primary) {
    throw new ConfigValidationError('Config must have a primary endpoint');
  }

  validateEndpoint(config.primary, 'Primary');

  if (config.secondary) {
    validateEndpoint(config.secondary, 'Secondary');
  }

  if (config.timeoutMs !== undefined && config.timeoutMs <= 0) {
    throw new ConfigValidationError('timeoutMs must be positive');
  }

  if (config.retryAttempts !== undefined && config.retryAttempts < 0) {
    throw new ConfigValidationError('retryAttempts cannot be negative');
  }

  if (config.retryBackoffMs !== undefined && config.retryBackoffMs <= 0) {
    throw new ConfigValidationError('retryBackoffMs must be positive');
  }

  if (config.healthCheckIntervalMs !== undefined && config.healthCheckIntervalMs <= 0) {
    throw new ConfigValidationError('healthCheckIntervalMs must be positive');
  }
}

/**
 * Creates a default broker configuration with sensible defaults
 */
export function createDefaultConfig(
  primaryUrl: string,
  primaryToken?: string,
  primaryTokenCommand?: string
): BrokerConfig {
  const primary: BrokerEndpoint = { url: primaryUrl };
  if (primaryToken) {
    primary.token = primaryToken;
  }
  if (primaryTokenCommand) {
    primary.tokenCommand = primaryTokenCommand;
  }
  
  return {
    primary,
    timeoutMs: 30000, // 30 seconds
    retryAttempts: 1,
    retryBackoffMs: 1000, // 1 second
    healthCheckIntervalMs: 60000, // 1 minute
  };
}

/**
 * Normalizes a URL by removing trailing slashes
 */
export function normalizeUrl(url: string): string {
  return url.replace(/\/+$/, '');
}