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
      <AuthProvider><App /></AuthProvider>
    </MemoryRouter>,
  );
}

function mockMe(permissions: string[]) {
  apiMocks.me.mockResolvedValue({
    user: { id: 'u1', email: 'user@example.com' },
    roles: ['user'],
    permissions,
    isAdmin: false,
    session: { idleExpiresAt: null, absoluteExpiresAt: null },
  });
}

describe('permission-based frontend authorization', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    apiMocks.flags.mockResolvedValue({ flags: {} });
    apiMocks.mfaStatus.mockResolvedValue({ enabled: false });
    apiMocks.getSettings.mockResolvedValue({ settings: [] });
  });

  it('hydrates permissions for navigation and guards routes by capability', async () => {
    mockMe(['users:read']);
    renderApp('/admin/settings');

    await screen.findByText('You are signed in.');
    expect(screen.getByRole('link', { name: 'User Access' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Settings' })).toBeNull();
    expect(apiMocks.getSettings).not.toHaveBeenCalled();
  });

  it('renders settings read-only without settings:update', async () => {
    mockMe(['settings:read']);
    renderApp('/admin/settings');

    await screen.findByRole('heading', { name: 'Timeout settings' });
    expect(screen.getByText('You have read-only access to these settings.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Save settings' })).toBeNull();
  });

  it('searches users and updates assignments from fixed roles', async () => {
    mockMe(['users:read', 'users:roles:update']);
    apiMocks.getAdminUsers.mockResolvedValue({
      users: [{
        id: 'u2',
        email: 'target@example.com',
        roles: ['user'],
        createdAt: '2026-01-01T00:00:00.000Z',
      }],
      nextCursor: null,
    });
    apiMocks.getAdminRoles.mockResolvedValue({
      roles: [
        { key: 'user', name: 'User', description: 'Base access', permissions: [] },
        {
          key: 'settings-manager',
          name: 'Settings manager',
          description: 'Manage settings',
          permissions: ['settings:read', 'settings:update'],
        },
      ],
    });
    apiMocks.updateAdminUserRoles.mockResolvedValue({
      user: {
        id: 'u2',
        email: 'target@example.com',
        roles: ['user', 'settings-manager'],
        permissions: ['settings:read', 'settings:update'],
      },
    });
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    renderApp('/admin/users');
    await screen.findByText('target@example.com');

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search users' }), {
      target: { value: 'target' },
    });
    await waitFor(() =>
      expect(apiMocks.getAdminUsers).toHaveBeenLastCalledWith(
        expect.objectContaining({ search: 'target' }),
      ),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Edit roles' }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Settings manager/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Save roles' }));

    await waitFor(() =>
      expect(apiMocks.updateAdminUserRoles).toHaveBeenCalledWith(
        'u2',
        expect.arrayContaining(['user', 'settings-manager']),
      ),
    );
    expect(await screen.findByText('Roles updated for target@example.com.')).toBeTruthy();
  });
});
