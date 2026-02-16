import { test, describe, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert';
import { TokenResolver, TokenResolutionError } from '../dist/index.js';

describe('TokenResolver', () => {
  let tokenResolver;

  beforeEach(() => {
    tokenResolver = new TokenResolver();
  });

  test('should resolve static token', async () => {
    const endpoint = { url: 'https://broker.example.com', token: 'static-token' };
    const token = await tokenResolver.resolveToken(endpoint);
    assert.strictEqual(token, 'static-token');
  });

  test('should handle missing token/command', async () => {
    const endpoint = { url: 'https://broker.example.com' };
    
    await assert.rejects(
      tokenResolver.resolveToken(endpoint),
      (error) => error instanceof TokenResolutionError
    );
  });

  test('should get cache stats', () => {
    // Initially empty
    let stats = tokenResolver.getCacheStats();
    assert.strictEqual(stats.size, 0);
    assert.strictEqual(stats.entries.length, 0);
  });

  test('should clear all token cache', () => {
    // Clear cache should not throw
    tokenResolver.clearAllTokenCache();
    
    const stats = tokenResolver.getCacheStats();
    assert.strictEqual(stats.size, 0);
  });

  test('should clear token cache for endpoint', () => {
    const endpoint = { url: 'https://broker.example.com', tokenCommand: 'echo test' };
    
    // Should not throw even if cache is empty
    tokenResolver.clearTokenCache(endpoint);
    
    const stats = tokenResolver.getCacheStats();
    assert.strictEqual(stats.size, 0);
  });

  test('should cleanup expired tokens', () => {
    // Should not throw even if cache is empty
    tokenResolver.cleanupExpiredTokens();
    
    const stats = tokenResolver.getCacheStats();
    assert.strictEqual(stats.size, 0);
  });
});