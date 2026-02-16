import { test, describe, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert';
import { 
  BrokerClient, 
  createDefaultConfig, 
  shouldFailover,
  calculateBackoffDelay,
  BrokerUnreachableError,
  BrokerAuthFailedError 
} from '../dist/index.js';

// Mock fetch globally
const originalFetch = globalThis.fetch;

describe('Failover Logic', () => {
  let mockFetch;
  
  beforeEach(() => {
    mockFetch = mock.fn();
    globalThis.fetch = mockFetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe('shouldFailover', () => {
    test('should failover on network errors', () => {
      const error = new BrokerUnreachableError('Network error', 'https://broker.example.com');
      assert.strictEqual(shouldFailover(error), true);
    });

    test('should failover on auth errors', () => {
      assert.strictEqual(shouldFailover(null, 401), true);
      assert.strictEqual(shouldFailover(null, 403), true);
    });

    test('should failover on server errors', () => {
      assert.strictEqual(shouldFailover(null, 500), true);
      assert.strictEqual(shouldFailover(null, 502), true);
      assert.strictEqual(shouldFailover(null, 503), true);
    });

    test('should not failover on client errors (except auth)', () => {
      assert.strictEqual(shouldFailover(null, 400), false);
      assert.strictEqual(shouldFailover(null, 404), false);
      assert.strictEqual(shouldFailover(null, 422), false);
    });
  });

  describe('calculateBackoffDelay', () => {
    test('should calculate exponential backoff', () => {
      assert.strictEqual(calculateBackoffDelay(1, 1000), 1000);
      assert.strictEqual(calculateBackoffDelay(2, 1000), 2000);
      assert.strictEqual(calculateBackoffDelay(3, 1000), 4000);
      assert.strictEqual(calculateBackoffDelay(4, 1000), 8000);
    });

    test('should cap at maximum delay', () => {
      assert.strictEqual(calculateBackoffDelay(10, 1000), 30000);
      assert.strictEqual(calculateBackoffDelay(20, 1000), 30000);
    });
  });
});

describe('BrokerClient Failover', () => {
  let mockFetch;
  let client;
  let config;

  beforeEach(() => {
    mockFetch = mock.fn();
    globalThis.fetch = mockFetch;
    
    config = createDefaultConfig('https://primary.example.com', 'primary-token');
    config.secondary = {
      url: 'https://secondary.example.com',
      token: 'secondary-token'
    };
    client = new BrokerClient(config);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    client?.destroy();
  });

  test('should use primary endpoint initially', () => {
    const status = client.getStatus();
    assert.strictEqual(status.activeEndpoint, 'primary');
    assert.strictEqual(status.primaryUrl, 'https://primary.example.com');
    assert.strictEqual(status.secondaryUrl, 'https://secondary.example.com');
  });

  test('should failover to secondary on primary failure', async () => {
    let callCount = 0;
    mockFetch.mock.mockImplementation((url) => {
      callCount++;
      if (callCount === 1 && url.includes('primary')) {
        // Primary fails with server error
        return Promise.resolve({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
          json: () => Promise.resolve({ error: 'Internal Server Error' })
        });
      } else if (url.includes('secondary')) {
        // Secondary succeeds
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ discord: 'token' })
        });
      }
      return Promise.reject(new Error('Unexpected URL'));
    });

    const tokens = await client.getChannelTokens();
    assert.deepStrictEqual(tokens, { discord: 'token' });
    
    // Should have made 2 calls: primary (failed) + secondary (success)
    assert.strictEqual(mockFetch.mock.callCount(), 2);
    
    // Client should now be on secondary
    const status = client.getStatus();
    assert.strictEqual(status.activeEndpoint, 'secondary');
  });

  test('should failover immediately on auth errors', async () => {
    let callCount = 0;
    mockFetch.mock.mockImplementation((url) => {
      callCount++;
      if (callCount === 1 && url.includes('primary')) {
        // Primary fails with auth error
        return Promise.resolve({
          ok: false,
          status: 401,
          statusText: 'Unauthorized',
          json: () => Promise.resolve({ error: 'Unauthorized' })
        });
      } else if (url.includes('secondary')) {
        // Secondary succeeds
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ discord: 'token' })
        });
      }
      return Promise.reject(new Error('Unexpected URL'));
    });

    const tokens = await client.getChannelTokens();
    assert.deepStrictEqual(tokens, { discord: 'token' });
    
    // Should have made 2 calls: primary (auth failed) + secondary (success)
    assert.strictEqual(mockFetch.mock.callCount(), 2);
  });

  test('should not failover on client errors', async () => {
    mockFetch.mock.mockImplementation(() => 
      Promise.resolve({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        json: () => Promise.resolve({ error: 'Bad Request' })
      })
    );

    await assert.rejects(client.getChannelTokens());
    
    // Should have made only 1 call (no failover)
    assert.strictEqual(mockFetch.mock.callCount(), 1);
    
    // Should still be on primary
    const status = client.getStatus();
    assert.strictEqual(status.activeEndpoint, 'primary');
  });

  test('should handle network errors with failover', async () => {
    let callCount = 0;
    mockFetch.mock.mockImplementation((url) => {
      callCount++;
      if (callCount === 1 && url.includes('primary')) {
        // Primary fails with network error
        const error = new Error('ECONNREFUSED');
        error.code = 'ECONNREFUSED';
        return Promise.reject(error);
      } else if (url.includes('secondary')) {
        // Secondary succeeds
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ discord: 'token' })
        });
      }
      return Promise.reject(new Error('Unexpected URL'));
    });

    const tokens = await client.getChannelTokens();
    assert.deepStrictEqual(tokens, { discord: 'token' });
    
    // Should have made 2 calls: primary (network error) + secondary (success)
    assert.strictEqual(mockFetch.mock.callCount(), 2);
  });

  test('should throw original error if both endpoints fail', async () => {
    mockFetch.mock.mockImplementation(() => 
      Promise.resolve({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: () => Promise.resolve({ error: 'Internal Server Error' })
      })
    );

    await assert.rejects(client.getChannelTokens());
    
    // Should have made 2 calls: primary (failed) + secondary (failed)
    assert.strictEqual(mockFetch.mock.callCount(), 2);
  });
});