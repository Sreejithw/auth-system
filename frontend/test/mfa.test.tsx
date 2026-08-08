// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';
import { AuthProvider } from '../src/auth/AuthContext';
import MfaSecurity from '../src/components/MfaSecurity';

const { apiMocks } = vi.hoisted(() => ({
  apiMocks: {
    flags: vi.fn(),
    me: vi.fn(),
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
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
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

describe('MFA login and safety', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    apiMocks.flags.mockResolvedValue({ flags: {} });
    apiMocks.me.mockRejectedValue(new Error('not signed in'));
    apiMocks.logout.mockResolvedValue(undefined);
  });

  it('keeps the user unauthenticated until MFA verification succeeds', async () => {
    apiMocks.login.mockResolvedValue({ mfaRequired: true });

    renderApp('/login');
    await screen.findByRole('heading', { name: 'Welcome back' });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'user@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await screen.findByRole('heading', { name: 'Verify your sign-in' });
    expect(apiMocks.verifyMfa).not.toHaveBeenCalled();
    expect(screen.queryByText('You are signed in.')).toBeNull();
  });

  it('redirects direct MFA verification navigation to login', async () => {
    renderApp('/mfa/verify');
    await screen.findByRole('heading', { name: 'Welcome back' });
  });

  it('does not retain setup secrets after setup is cancelled', async () => {
    apiMocks.mfaStatus.mockResolvedValue({ enabled: false });
    apiMocks.setupMfa.mockResolvedValue({
      provisioningUri: 'otpauth://totp/Example:user@example.com?secret=ABC123',
      manualSecret: 'ABC123',
    });

    render(<MfaSecurity />);
    await screen.findByRole('button', { name: 'Set up authenticator app' });
    fireEvent.click(screen.getByRole('button', { name: 'Set up authenticator app' }));
    await screen.findByText('ABC123');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByText('ABC123')).toBeNull());
  });
});
