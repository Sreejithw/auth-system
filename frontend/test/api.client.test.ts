import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, clearCsrfToken } from '../src/api/client';

vi.mock('../src/config/runtimeConfig', () => ({
  getRuntimeConfig: () => ({ apiUrl: 'http://localhost:4000' }),
}));

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('API authorization errors', () => {
  beforeEach(() => {
    clearCsrfToken();
    vi.unstubAllGlobals();
  });

  it('preserves backend error codes and does not retry ordinary forbidden mutations', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ csrfToken: 'csrf-1' }))
      .mockResolvedValueOnce(jsonResponse({ error: 'Forbidden', code: 'FORBIDDEN' }, 403));
    vi.stubGlobal('fetch', fetchMock);

    const error = await api.updateSettings([]).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 403, code: 'FORBIDDEN', message: 'Forbidden' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('refreshes and retries once for INVALID_CSRF_TOKEN', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ csrfToken: 'csrf-1' }))
      .mockResolvedValueOnce(
        jsonResponse({ error: 'Stale token', code: 'INVALID_CSRF_TOKEN' }, 403),
      )
      .mockResolvedValueOnce(jsonResponse({ csrfToken: 'csrf-2' }))
      .mockResolvedValueOnce(jsonResponse({ settings: [] }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(api.updateSettings([])).resolves.toEqual({ settings: [] });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls[3][1].headers['x-csrf-token']).toBe('csrf-2');
  });
});
