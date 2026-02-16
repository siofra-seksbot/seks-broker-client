#!/usr/bin/env node

/**
 * Example usage of the SEKS Broker Client
 */

import { BrokerClient, createDefaultConfig } from '@seksbot/broker-client';

async function example() {
  // Create configuration
  const config = createDefaultConfig(
    'https://broker.example.com',
    'your-agent-token'
  );

  // Add secondary endpoint for failover
  config.secondary = {
    url: 'https://backup-broker.example.com',
    token: 'your-backup-token'
  };

  // Create client with optional logger
  const logger = {
    debug: (msg, ...args) => console.debug(`[DEBUG] ${msg}`, ...args),
    info: (msg, ...args) => console.info(`[INFO] ${msg}`, ...args),
    warn: (msg, ...args) => console.warn(`[WARN] ${msg}`, ...args),
    error: (msg, ...args) => console.error(`[ERROR] ${msg}`, ...args),
  };

  const client = new BrokerClient(config, logger);

  try {
    // Check client status
    console.log('Client Status:', client.getStatus());

    // Test connection
    const health = await client.ping();
    console.log('Health Check:', health);

    // Get agent capabilities
    const capabilities = await client.listCapabilities();
    console.log('Capabilities:', capabilities);

    // Get channel tokens
    const tokens = await client.getChannelTokens();
    console.log('Channel Tokens:', Object.keys(tokens));

    // Get a specific secret
    try {
      const secret = await client.getSecret('example', 'api_key');
      console.log('Retrieved secret:', secret ? '***' : 'null');
    } catch (error) {
      console.log('Secret not found:', error.message);
    }

    // Make a proxied API request
    try {
      const response = await client.proxyRequest('discord', 'users/@me');
      const user = await response.json();
      console.log('Discord User:', user.username || 'N/A');
    } catch (error) {
      console.log('Proxy request failed:', error.message);
    }

  } catch (error) {
    console.error('Client error:', error.message);
  } finally {
    // Clean up
    client.destroy();
  }
}

// Run example if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  example().catch(console.error);
}