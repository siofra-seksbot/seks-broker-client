/**
 * SEKS Broker Client Library
 * 
 * A TypeScript/Node.js client library for communicating with SEKS brokers.
 * Provides automatic failover, token resolution, and connection pooling.
 */

// Main client class
export { BrokerClient } from './client.js';

// Configuration helpers
export { 
  validateConfig, 
  validateEndpoint, 
  createDefaultConfig, 
  normalizeUrl 
} from './config.js';

// Token resolution
export { TokenResolver } from './token.js';

// Failover management
export { 
  FailoverManager, 
  shouldFailover, 
  calculateBackoffDelay 
} from './failover.js';

// All types and errors
export type {
  BrokerConfig,
  BrokerEndpoint,
  Logger,
  ChannelTokens,
  AgentCapabilities,
  BrokerProxyRequestOptions,
  BrokerAuthVerifyRequest,
  BrokerAuthVerifyResponse,
  BrokerError,
  HealthCheckResult,
} from './types.js';

export {
  BrokerClientError,
  BrokerUnreachableError,
  BrokerAuthFailedError,
  SecretNotFoundError,
  TokenResolutionError,
  ConfigValidationError,
} from './types.js';