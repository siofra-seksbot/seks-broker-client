# SEKS Broker Client

A TypeScript/Node.js client library for communicating with SEKS brokers. This package provides a unified interface for all SEKS tools (OpenClaw Gateway, seksh, seks-http, seks-git, seksbot-store API) to interact with the broker.

## Why This Exists

Before this library, every SEKS tool had to implement its own broker communication logic, leading to:
- Duplicated code across projects
- Inconsistent error handling
- Different failover strategies
- Varied token resolution approaches

The `@seksbot/broker-client` package solves this by providing a single, well-tested client that all tools can share.

## Features

- **Dual-endpoint failover**: Automatic fallback from primary to secondary broker
- **Token resolution**: Support for both static tokens and command-based tokens
- **Connection pooling**: HTTP keep-alive for better performance
- **Comprehensive error handling**: Typed errors for different failure scenarios
- **Zero dependencies**: Uses only Node.js built-ins
- **ESM module**: Modern ES module format
- **Full TypeScript support**: Complete type definitions

## Installation

```bash
npm install @seksbot/broker-client
```

## Quick Start

```typescript
import { BrokerClient, createDefaultConfig } from '@seksbot/broker-client';

// Simple configuration with static token
const config = createDefaultConfig(
  'https://broker.example.com',
  'your-agent-token'
);

const client = new BrokerClient(config);

// Get channel tokens
const tokens = await client.getChannelTokens();
console.log(tokens.discord); // Discord bot token

// Get a specific secret
const apiKey = await client.getSecret('openai', 'api_key');

// Make a proxied API request
const response = await client.proxyRequest('discord', 'guilds/123456789');
const guilds = await response.json();
```

## Configuration

### Basic Configuration

```typescript
import { BrokerConfig } from '@seksbot/broker-client';

const config: BrokerConfig = {
  primary: {
    url: 'https://primary-broker.example.com',
    token: 'your-primary-token'
  }
};
```

### Dual-Endpoint Configuration with Failover

```typescript
const config: BrokerConfig = {
  primary: {
    url: 'https://primary-broker.example.com',
    token: 'primary-token'
  },
  secondary: {
    url: 'https://secondary-broker.example.com',
    token: 'secondary-token'
  },
  timeoutMs: 30000,
  retryAttempts: 1,
  healthCheckIntervalMs: 60000
};
```

### Token Commands

Instead of static tokens, you can use shell commands to retrieve tokens dynamically:

```typescript
const config: BrokerConfig = {
  primary: {
    url: 'https://broker.example.com',
    tokenCommand: 'seksh get-token'
  }
};
```

This is useful when:
- Tokens are stored in external systems
- You need to refresh tokens periodically
- Different environments use different token sources

## Failover Behavior

The client automatically handles failover between primary and secondary endpoints:

### When Failover Occurs

1. **Network errors**: Connection refused, timeouts, DNS failures
2. **Server errors**: HTTP 5xx responses
3. **Authentication errors**: HTTP 401/403 (tries secondary immediately)

### When Failover Does NOT Occur

1. **Client errors**: HTTP 4xx (except 401/403) - these are client-side issues
2. **No secondary configured**: Falls back to retrying primary

### Failover Process

1. Try primary endpoint first
2. On failure, determine if failover is appropriate
3. Clear token cache for failed endpoint
4. Switch to secondary endpoint
5. Periodic health checks attempt to restore primary

### Sticky Behavior

Once failed over to secondary, the client stays on secondary until:
- A health check confirms primary is healthy again
- Manual intervention (restart, token refresh, etc.)

## API Reference

### Core Methods

#### `resolveToken(): Promise<string>`
Get the agent's auth token for the currently active broker endpoint.

#### `getChannelTokens(): Promise<ChannelTokens>`
Retrieve all channel tokens (Discord, Telegram, etc.) for this agent.

```typescript
const tokens = await client.getChannelTokens();
// Returns: { discord?: string, telegram?: string, ... }
```

#### `getSecret(provider: string, field: string): Promise<string>`
Get a specific secret field from a provider.

```typescript
const apiKey = await client.getSecret('openai', 'api_key');
const dbPassword = await client.getSecret('postgres', 'password');
```

#### `listCapabilities(): Promise<AgentCapabilities>`
List what this agent can do - available providers, channels, and features.

```typescript
const capabilities = await client.listCapabilities();
console.log(capabilities.providers); // ['discord', 'telegram', 'openai']
```

#### `proxyRequest(provider: string, path: string, options?: BrokerProxyRequestOptions): Promise<Response>`
Make an API call to a provider through the broker. The broker injects appropriate credentials.

```typescript
// GET request
const response = await client.proxyRequest('discord', 'users/@me');
const user = await response.json();

// POST request
const response = await client.proxyRequest('discord', 'channels/123/messages', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ content: 'Hello!' })
});
```

#### `ping(): Promise<HealthCheckResult>`
Perform a health check on the currently active endpoint.

```typescript
const health = await client.ping();
console.log(health.healthy); // true/false
console.log(health.responseTimeMs); // latency
```

#### `verifyToken(): Promise<BrokerAuthVerifyResponse>`
Verify that the current agent token is valid.

### Utility Methods

#### `getStatus()`
Get current client status and configuration.

```typescript
const status = client.getStatus();
console.log(status.activeEndpoint); // 'primary' | 'secondary'
console.log(status.primaryUrl);
console.log(status.cacheStats);
```

#### `clearTokenCache()`
Clear all cached tokens (forces re-resolution on next request).

#### `destroy()`
Clean up resources, stop health checks, clear caches.

## Error Handling

The client provides typed errors for different scenarios:

```typescript
import { 
  BrokerUnreachableError,
  BrokerAuthFailedError, 
  SecretNotFoundError,
  TokenResolutionError 
} from '@seksbot/broker-client';

try {
  await client.getSecret('provider', 'field');
} catch (error) {
  if (error instanceof SecretNotFoundError) {
    console.log(`Secret ${error.provider}.${error.field} not found`);
  } else if (error instanceof BrokerUnreachableError) {
    console.log(`Cannot reach broker at ${error.endpoint}`);
  } else if (error instanceof BrokerAuthFailedError) {
    console.log(`Authentication failed: ${error.statusCode}`);
  }
}
```

## Logging

The client accepts an optional logger interface:

```typescript
const logger = {
  debug: (msg, ...args) => console.debug(msg, ...args),
  info: (msg, ...args) => console.info(msg, ...args),
  warn: (msg, ...args) => console.warn(msg, ...args),
  error: (msg, ...args) => console.error(msg, ...args),
};

const client = new BrokerClient(config, logger);
```

## Testing

Run tests using Node.js built-in test runner:

```bash
# Build the TypeScript first
npm run build

# Run tests
npm test

# Or with vitest
npm run test:vitest
```

## Common Patterns

### Environment-based Configuration

```typescript
function createBrokerConfig(): BrokerConfig {
  const primaryUrl = process.env.SEKS_BROKER_PRIMARY_URL!;
  const secondaryUrl = process.env.SEKS_BROKER_SECONDARY_URL;
  
  if (process.env.SEKS_BROKER_TOKEN) {
    // Static token
    return {
      primary: { url: primaryUrl, token: process.env.SEKS_BROKER_TOKEN },
      secondary: secondaryUrl ? { url: secondaryUrl, token: process.env.SEKS_BROKER_SECONDARY_TOKEN } : undefined
    };
  } else {
    // Command-based token
    return {
      primary: { url: primaryUrl, tokenCommand: 'seksh get-token' },
      secondary: secondaryUrl ? { url: secondaryUrl, tokenCommand: 'seksh get-secondary-token' } : undefined
    };
  }
}
```

### Graceful Shutdown

```typescript
process.on('SIGINT', () => {
  client.destroy();
  process.exit(0);
});
```

### Retry with Backoff

```typescript
import { calculateBackoffDelay } from '@seksbot/broker-client';

async function retryOperation(operation, maxAttempts = 3) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (attempt === maxAttempts) throw error;
      
      const delay = calculateBackoffDelay(attempt);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}
```

## Migration from Direct Broker Calls

If you're migrating from direct fetch calls to the broker:

**Before:**
```typescript
const response = await fetch(`${brokerUrl}/v1/secrets/discord/token`, {
  headers: { Authorization: `Bearer ${token}` }
});
const data = await response.json();
```

**After:**
```typescript
const token = await client.getSecret('discord', 'token');
```

## Future Plans

- **WebSocket Support**: The broker will eventually support WebSocket connections for real-time updates
- **Connection Multiplexing**: HTTP/2 and HTTP/3 support when available
- **Metrics Collection**: Built-in metrics for monitoring and debugging
- **Circuit Breaker**: More sophisticated failure detection and recovery

## Contributing

1. Fork the repository
2. Create a feature branch
3. Add tests for new functionality
4. Ensure all tests pass
5. Submit a pull request

## License

MIT