import { test, describe, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert';
import { BrokerClient, createDefaultConfig, BrokerAuthFailedError } from '../dist/index.js';

// Mock fetch globally
const originalFetch = globalThis.fetch;

describe('BrokerClient', () => {
  let mockFetch;
  let client;
  let config;

  beforeEach(() => {
    mockFetch = mock.fn();
    globalThis.fetch = mockFetch;
    
    config = createDefaultConfig('https://broker.example.com', 'test-token');
    client = new BrokerClient(config);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    client?.destroy();
  });

  test('should create client with valid config', () => {
    assert.ok(client instanceof BrokerClient);
  });

  test('should resolve token', async () => {
    const token = await client.resolveToken();
    assert.strictEqual(token, 'test-token');
  });

  test('should get channel tokens', async () => {
    const mockTokens = { discord: 'discord-token', telegram: 'telegram-token' };
    mockFetch.mock.mockImplementation(() => 
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(mockTokens)
      })
    );

    const tokens = await client.getChannelTokens();
    assert.deepStrictEqual(tokens, mockTokens);
    
    // Verify fetch was called with correct parameters
    const call = mockFetch.mock.calls[0];
    assert.ok(call.arguments[0].endsWith('/v1/tokens/channels'));
    assert.strictEqual(call.arguments[1].headers.Authorization, 'Bearer test-token');
  });

  test('should get secret', async () => {
    const mockSecret = { value: 'secret-value' };
    mockFetch.mock.mockImplementation(() => 
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(mockSecret)
      })
    );

    const secret = await client.getSecret('discord', 'token');
    assert.strictEqual(secret, 'secret-value');
    
    // Verify correct URL
    const call = mockFetch.mock.calls[0];
    assert.ok(call.arguments[0].endsWith('/v1/secrets/discord/token'));
  });

  test('should list capabilities', async () => {
    const mockCapabilities = {
      providers: ['discord', 'telegram'],
      channels: ['discord', 'telegram'],
      features: ['proxy', 'secrets'],
      agent_id: 'test-agent',
      agent_name: 'Test Agent'
    };
    
    mockFetch.mock.mockImplementation(() => 
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(mockCapabilities)
      })
    );

    const capabilities = await client.listCapabilities();
    assert.deepStrictEqual(capabilities, mockCapabilities);
  });

  test('should make proxy request', async () => {
    const mockResponse = { data: 'test' };
    mockFetch.mock.mockImplementation(() => 
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(mockResponse)
      })
    );

    const response = await client.proxyRequest('discord', 'guilds/123');
    const data = await response.json();
    assert.deepStrictEqual(data, mockResponse);
    
    // Verify proxy URL
    const call = mockFetch.mock.calls[0];
    assert.ok(call.arguments[0].endsWith('/v1/proxy/discord/guilds/123'));
  });

  test('should handle auth errors', async () => {
    mockFetch.mock.mockImplementation(() => 
      Promise.resolve({
        ok: false,
        status: 401,
        statusText: 'Unauthorized'
      })
    );

    await assert.rejects(
      client.getChannelTokens(),
      (error) => error instanceof BrokerAuthFailedError
    );
  });

  test('should ping successfully', async () => {
    mockFetch.mock.mockImplementation(() => 
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ status: 'ok' })
      })
    );

    const result = await client.ping();
    assert.strictEqual(result.healthy, true);
    assert.strictEqual(result.endpoint, 'primary');
  });

  test('should verify token', async () => {
    const mockVerifyResponse = {
      valid: true,
      agent_id: 'test-agent',
      agent_name: 'Test Agent'
    };
    
    mockFetch.mock.mockImplementation(() => 
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(mockVerifyResponse)
      })
    );

    const result = await client.verifyToken();
    assert.deepStrictEqual(result, mockVerifyResponse);
    
    // Verify it was a POST request
    const call = mockFetch.mock.calls[0];
    assert.strictEqual(call.arguments[1].method, 'POST');
    assert.ok(call.arguments[0].endsWith('/v1/auth/verify'));
  });

  test('should get status', () => {
    const status = client.getStatus();
    assert.strictEqual(status.activeEndpoint, 'primary');
    assert.strictEqual(status.primaryUrl, 'https://broker.example.com');
    assert.strictEqual(status.secondaryUrl, undefined);
    assert.ok(status.cacheStats);
  });
});