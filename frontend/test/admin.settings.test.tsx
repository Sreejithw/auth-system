// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';
import { AuthProvider } from '../src/auth/AuthContext';

const { apiMocks } = vi.hoisted(() => ({
  apiMocks: {
    flags: vi.fn(),
    me: vi.fn(),
    getSettings: vi.fn(),
    updateSettings: vi.fn(),
    getAdminUsers: vi.fn(),
    getAdminRoles: vi.fn(),
    updateAdminUserRoles: vi.fn(),
    register: vi.fn(),
    login: vi.fn(),
    verifyMfa: vi.fn(),
    mfaStatus: vi.fn(),
    setupMfa: vi.fn(),
    enableMfa: vi.fn(),
    disableMfa: vi.fn(),
    regenerateRecoveryCodes: vi.fn(),
    logout: vi.fn(),
  },
}));

vi.mock('../src/api/client', () => ({
  api: apiMocks,
  clearCsrfToken: vi.fn(),
  ApiError: class ApiError extends Error {
    status: number;
    code?: string;
    constructor(message: string, status: number, code?: string) {
      super(message);
      this.status = status;
      this.code = code;
    }
  },
}));

vi.mock('../src/config/runtimeConfig', () => ({
  getRuntimeConfig: () => ({
    apiUrl: 'http://localhost:4000',
    version: 'test',
    gitSha: 'abcdef0',
    buildTime: 'now',
  }),
}));

function renderApp(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe('Admin settings screen', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    apiMocks.flags.mockResolvedValue({ flags: {} });
    apiMocks.logout.mockResolvedValue(undefined);
    apiMocks.mfaStatus.mockResolvedValue({ enabled: false });
  });

  it('hides settings from non-admin users', async () => {
    apiMocks.me.mockResolvedValue({
      user: { id: 'u1', email: 'user@example.com' },
      roles: ['user'],
      permissions: [],
      isAdmin: false,
      session: { idleExpiresAt: null, absoluteExpiresAt: null },
    });

    renderApp('/admin/settings');
    await screen.findByText('You are signed in.');
    expect(screen.queryByRole('heading', { name: 'Timeout settings' })).toBeNull();
  });

  it('loads and saves settings for admin users', async () => {
    apiMocks.me.mockResolvedValue({
      user: { id: 'a1', email: 'admin@example.com' },
      roles: ['user', 'administrator'],
      permissions: ['settings:read', 'settings:update', 'users:read', 'users:roles:update'],
      isAdmin: true,
      session: {
        idleExpiresAt: '2026-08-23T06:00:00.000Z',
        absoluteExpiresAt: '2026-08-23T10:00:00.000Z',
      },
    });
    apiMocks.getSettings.mockResolvedValue({
      settings: [
        {
          key: 'session.idle_ttl_ms',
          description: 'Rolling idle session lifetime',
          valueMs: 8 * 60 * 60 * 1000,
          updatedAt: null,
          updatedBy: null,
        },
        {
          key: 'session.absolute_ttl_ms',
          description: 'Maximum authenticated session lifetime',
          valueMs: 24 * 60 * 60 * 1000,
          updatedAt: null,
          updatedBy: null,
        },
        {
          key: 'session.store_prune_interval_ms',
          description: 'Interval for pruning expired session rows',
          valueMs: 15 * 60 * 1000,
          updatedAt: null,
          updatedBy: null,
        },
        {
          key: 'mfa.challenge_ttl_ms',
          description: 'Pending MFA login challenge and setup window',
          valueMs: 10 * 60 * 1000,
          updatedAt: null,
          updatedBy: null,
        },
        {
          key: 'mfa.recent_auth_ttl_ms',
          description: 'Window for sensitive MFA actions after full auth',
          valueMs: 10 * 60 * 1000,
          updatedAt: null,
          updatedBy: null,
        },
        {
          key: 'auth.lockout_duration_ms',
          description: 'Account lockout duration after failed logins',
          valueMs: 15 * 60 * 1000,
          updatedAt: null,
          updatedBy: null,
        },
        {
          key: 'auth.lockout_max_failed_attempts',
          description: 'Failed logins before account lockout',
          valueInt: 5,
          updatedAt: null,
          updatedBy: null,
        },
        {
          key: 'rate_limit.global.window_ms',
          description: 'Global per-IP rate-limit window',
          valueMs: 15 * 60 * 1000,
          updatedAt: null,
          updatedBy: null,
        },
        {
          key: 'rate_limit.global.max',
          description: 'Max requests per global rate-limit window',
          valueInt: 300,
          updatedAt: null,
          updatedBy: null,
        },
        {
          key: 'rate_limit.auth.window_ms',
          description: 'Login/register per-IP rate-limit window',
          valueMs: 15 * 60 * 1000,
          updatedAt: null,
          updatedBy: null,
        },
        {
          key: 'rate_limit.auth.max',
          description: 'Max failed auth attempts per rate-limit window',
          valueInt: 10,
          updatedAt: null,
          updatedBy: null,
        },
        {
          key: 'rate_limit.mfa.window_ms',
          description: 'MFA per-IP rate-limit window',
          valueMs: 15 * 60 * 1000,
          updatedAt: null,
          updatedBy: null,
        },
        {
          key: 'rate_limit.mfa.max',
          description: 'Max failed MFA attempts per rate-limit window',
          valueInt: 5,
          updatedAt: null,
          updatedBy: null,
        },
        {
          key: 'flags.evaluation_timeout_ms',
          description: 'Feature-flag provider evaluation timeout',
          valueMs: 750,
          updatedAt: null,
          updatedBy: null,
        },
      ],
    });
    apiMocks.updateSettings.mockImplementation(async (updates) => {
      const current = await apiMocks.getSettings();
      const next = current.settings.map((row: {
        key: string;
        valueMs?: number;
        valueInt?: number;
        description: string;
        updatedAt: string | null;
        updatedBy: string | null;
      }) => {
        const change = updates.find((item: { key: string }) => item.key === row.key);
        if (!change) return row;
        return {
          ...row,
          valueMs: change.valueMs,
          valueInt: change.valueInt,
        };
      });
      return { settings: next };
    });

    renderApp('/admin/settings');
    await screen.findByRole('heading', { name: 'Timeout settings' });

    const idleInput = screen.getByDisplayValue('480');
    fireEvent.change(idleInput, { target: { value: '240' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));

    await waitFor(() => expect(apiMocks.updateSettings).toHaveBeenCalled());
    const payload = apiMocks.updateSettings.mock.calls[0][0];
    expect(payload).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'session.idle_ttl_ms',
          valueMs: 240 * 60 * 1000,
        }),
      ]),
    );
  });
});
