import { describe, expect, it } from 'vitest';
import { parseRuntimeConfig } from '../src/config/runtimeConfig';

describe('runtime configuration parsing', () => {
  it('normalizes the API URL and applies safe metadata defaults', () => {
    expect(parseRuntimeConfig({ apiUrl: 'http://localhost:4000///' })).toEqual({
      apiUrl: 'http://localhost:4000',
      version: 'development',
      gitSha: 'unknown',
      buildTime: 'unknown',
    });
  });

  it('rejects invalid or non-HTTP API URLs', () => {
    expect(() => parseRuntimeConfig({ apiUrl: 'not-a-url' })).toThrow(
      'invalid apiUrl',
    );
    expect(() => parseRuntimeConfig({ apiUrl: 'file:///tmp/api' })).toThrow(
      'HTTP or HTTPS',
    );
  });
});
