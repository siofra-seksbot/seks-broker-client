/**
 * Core types for SEKS Broker Client
 */

export interface BrokerEndpoint {
  url: string;
  token?: string;
  tokenCommand?: string; // shell command that outputs a token
}

export interface BrokerConfig {
  primary: BrokerEndpoint;
  secondary?: BrokerEndpoint;
  timeoutMs?: number;
  retryAttempts?: number;
  retryBackoffMs?: number;
  healthCheckIntervalMs?: number;
}

export interface Logger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

export interface ChannelTokens {
  discord?: string;
  telegram?: string;
  whatsapp?: string;
  zulip?: string;
  slack?: string;
  [key: string]: string | undefined;
}

export interface AgentCapabilities {
  providers: string[];
  channels: string[];
  features: string[];
  agent_id: string;
  agent_name: string;
}

export interface BrokerProxyRequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string | Uint8Array | ReadableStream;
  params?: Record<string, string>;
}

export interface BrokerAuthVerifyRequest {
  token: string;
}

export interface BrokerAuthVerifyResponse {
  valid: boolean;
  agent_id: string;
  agent_name: string;
  expires_at?: string;
}

export interface BrokerError {
  error: string;
  code?: string;
  statusCode?: number;
  details?: unknown;
}

export interface HealthCheckResult {
  endpoint: 'primary' | 'secondary';
  healthy: boolean;
  responseTimeMs?: number;
  error?: string;
}

// Custom error types
export class BrokerClientError extends Error {
  constructor(message: string, public override cause?: unknown) {
    super(message);
    this.name = 'BrokerClientError';
  }
}

export class BrokerUnreachableError extends BrokerClientError {
  constructor(message: string, public endpoint: string, cause?: unknown) {
    super(message);
    this.name = 'BrokerUnreachableError';
    this.cause = cause;
  }
}

export class BrokerAuthFailedError extends BrokerClientError {
  constructor(message: string, public statusCode: number, cause?: unknown) {
    super(message);
    this.name = 'BrokerAuthFailedError';
    this.cause = cause;
  }
}

export class SecretNotFoundError extends BrokerClientError {
  constructor(public provider: string, public field: string, cause?: unknown) {
    super(`Secret not found: ${provider}.${field}`);
    this.name = 'SecretNotFoundError';
    this.cause = cause;
  }
}

export class TokenResolutionError extends BrokerClientError {
  constructor(message: string, public command?: string, cause?: unknown) {
    super(message);
    this.name = 'TokenResolutionError';
    this.cause = cause;
  }
}

export class ConfigValidationError extends BrokerClientError {
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'ConfigValidationError';
    this.cause = cause;
  }
}