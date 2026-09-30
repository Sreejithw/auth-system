import { getRuntimeConfig } from '../config/runtimeConfig';
import type { ClientFlags } from '../flags/definitions';

export interface ApiUser {
  id: string;
  email: string;
}

export interface SessionInfo {
  idleExpiresAt: string | null;
  absoluteExpiresAt: string | null;
}

export interface MeResponse {
  user: ApiUser;
  isAdmin: boolean;
  session: SessionInfo;
}

export type SettingKey =
  | 'session.idle_ttl_ms'
  | 'session.absolute_ttl_ms'
  | 'session.store_prune_interval_ms'
  | 'mfa.challenge_ttl_ms'
  | 'mfa.recent_auth_ttl_ms'
  | 'auth.lockout_duration_ms'
  | 'auth.lockout_max_failed_attempts'
  | 'rate_limit.global.window_ms'
  | 'rate_limit.global.max'
  | 'rate_limit.auth.window_ms'
  | 'rate_limit.auth.max'
  | 'rate_limit.mfa.window_ms'
  | 'rate_limit.mfa.max'
  | 'flags.evaluation_timeout_ms';

export interface AppSetting {
  key: SettingKey;
  description: string;
  valueMs?: number;
  valueInt?: number;
  updatedAt: string | null;
  updatedBy: string | null;
}

export interface SettingUpdate {
  key: SettingKey;
  valueMs?: number;
  valueInt?: number;
}

export interface MfaStatus {
  enabled: boolean;
}

export interface MfaSetup {
  provisioningUri: string;
  manualSecret: string;
}

export interface MfaProof {
  totpCode?: string;
  recoveryCode?: string;
}

export type LoginResponse =
  | { user: ApiUser; isAdmin?: boolean; mfaRequired?: false }
  | { mfaRequired: true; user?: never };

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
  const res = await fetch(`${getRuntimeConfig().apiUrl}/api/csrf-token`, {
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
    fetch(`${getRuntimeConfig().apiUrl}${path}`, {
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
  flags(): Promise<{ flags: ClientFlags }> {
    return request<{ flags: ClientFlags }>('/api/flags');
  },
  me(): Promise<MeResponse> {
    return request<MeResponse>('/api/auth/me');
  },
  getSettings(): Promise<{ settings: AppSetting[] }> {
    return request<{ settings: AppSetting[] }>('/api/admin/settings');
  },
  updateSettings(settings: SettingUpdate[]): Promise<{ settings: AppSetting[] }> {
    return request<{ settings: AppSetting[] }>('/api/admin/settings', {
      method: 'PUT',
      body: { settings },
    });
  },
  register(email: string, password: string): Promise<{ message: string }> {
    return request<{ message: string }>('/api/auth/register', {
      method: 'POST',
      body: { email, password },
    });
  },
  login(email: string, password: string): Promise<LoginResponse> {
    return request<LoginResponse>('/api/auth/login', {
      method: 'POST',
      body: { email, password },
    });
  },
  verifyMfa(proof: MfaProof): Promise<{ user: ApiUser }> {
    return request<{ user: ApiUser }>('/api/auth/mfa/verify', {
      method: 'POST',
      body: proof,
    });
  },
  mfaStatus(): Promise<MfaStatus> {
    return request<MfaStatus>('/api/auth/mfa');
  },
  setupMfa(): Promise<MfaSetup> {
    return request<MfaSetup>('/api/auth/mfa/setup', { method: 'POST' });
  },
  enableMfa(totpCode: string): Promise<{ recoveryCodes: string[] }> {
    return request<{ recoveryCodes: string[] }>('/api/auth/mfa/enable', {
      method: 'POST',
      body: { totpCode },
    });
  },
  disableMfa(password: string, proof: MfaProof): Promise<void> {
    return request<void>('/api/auth/mfa/disable', {
      method: 'POST',
      body: { password, ...proof },
    });
  },
  regenerateRecoveryCodes(password: string, proof: MfaProof): Promise<{ recoveryCodes: string[] }> {
    return request<{ recoveryCodes: string[] }>('/api/auth/mfa/recovery-codes/regenerate', {
      method: 'POST',
      body: { password, ...proof },
    });
  },
  logout(): Promise<void> {
    return request<void>('/api/auth/logout', { method: 'POST' });
  },
};
