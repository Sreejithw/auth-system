const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:4000';

export interface ApiUser {
  id: string;
  email: string;
}

/**
 * Thrown for non-2xx responses. `status` lets callers special-case things like
 * 401 (unauthenticated) vs. 400/409 (validation / conflict).
 */
export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

let csrfToken: string | null = null;

async function fetchCsrfToken(): Promise<string> {
  const res = await fetch(`${API_URL}/api/csrf-token`, {
    credentials: 'include',
  });
  if (!res.ok) {
    throw new ApiError('Could not obtain a security token. Please try again.', res.status);
  }
  const data = (await res.json()) as { csrfToken: string };
  csrfToken = data.csrfToken;
  return csrfToken;
}

async function ensureCsrfToken(): Promise<string> {
  if (csrfToken) return csrfToken;
  return fetchCsrfToken();
}

/** Drop the cached token so the next mutating request fetches a fresh one. */
export function clearCsrfToken(): void {
  csrfToken = null;
}

async function parseError(res: Response): Promise<string> {
  try {
    const data = await res.json();
    if (data && typeof data.message === 'string') return data.message;
    if (data && typeof data.error === 'string') return data.error;
  } catch {
    /* response had no JSON body */
  }
  return `Request failed (${res.status})`;
}

interface RequestOptions {
  method?: string;
  body?: unknown;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? 'GET';
  const isMutation = method !== 'GET' && method !== 'HEAD';

  const headers: Record<string, string> = {};
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (isMutation) {
    headers['x-csrf-token'] = await ensureCsrfToken();
  }

  const doFetch = () =>
    fetch(`${API_URL}${path}`, {
      method,
      credentials: 'include',
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });

  let res = await doFetch();

  // A 403 on a mutation usually means the CSRF token is stale/rotated; refresh once and retry.
  if (res.status === 403 && isMutation) {
    clearCsrfToken();
    headers['x-csrf-token'] = await fetchCsrfToken();
    res = await doFetch();
  }

  if (!res.ok) {
    throw new ApiError(await parseError(res), res.status);
  }

  if (res.status === 204) {
    return undefined as T;
  }

  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export const api = {
  me(): Promise<{ user: ApiUser }> {
    return request<{ user: ApiUser }>('/api/auth/me');
  },
  register(email: string, password: string): Promise<{ user: ApiUser }> {
    return request<{ user: ApiUser }>('/api/auth/register', {
      method: 'POST',
      body: { email, password },
    });
  },
  login(email: string, password: string): Promise<{ user: ApiUser }> {
    return request<{ user: ApiUser }>('/api/auth/login', {
      method: 'POST',
      body: { email, password },
    });
  },
  logout(): Promise<void> {
    return request<void>('/api/auth/logout', { method: 'POST' });
  },
};
