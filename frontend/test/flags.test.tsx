// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../src/api/client';
import { FlagProvider, useFlag } from '../src/flags/FlagContext';
import {
  CLIENT_FLAG_DEFAULTS,
  parseClientFlags,
} from '../src/flags/definitions';

vi.mock('../src/api/client', () => ({
  api: {
    flags: vi.fn(),
  },
}));

function FlagProbe() {
  const dashboard = useFlag('new-dashboard-rollout');
  const registration = useFlag('new-registration-flow');
  return <span>{`${dashboard}:${registration}`}</span>;
}

describe('FlagContext', () => {
  beforeEach(() => {
    vi.mocked(api.flags).mockReset();
  });

  it('exposes safe defaults when the flags request fails', async () => {
    vi.mocked(api.flags).mockRejectedValue(new Error('offline'));

    render(
      <FlagProvider authLoading={false} userId={null}>
        <FlagProbe />
      </FlagProvider>,
    );

    expect(screen.getByText('false:false')).toBeTruthy();
    await waitFor(() => expect(api.flags).toHaveBeenCalledOnce());
    expect(screen.getByText('false:false')).toBeTruthy();
  });

  it('publishes only parsed boolean values from the backend', async () => {
    vi.mocked(api.flags).mockResolvedValue({
      flags: {
        'new-registration-flow': false,
        'new-dashboard-rollout': true,
      },
    });

    render(
      <FlagProvider authLoading={false} userId="user-1">
        <FlagProbe />
      </FlagProvider>,
    );

    await screen.findByText('true:false');
  });
});

describe('client flag definitions', () => {
  it('defaults missing, invalid, and internal fields safely', () => {
    expect(
      parseClientFlags({
        'new-dashboard-rollout': 'yes',
        'registration-enabled': false,
      }),
    ).toEqual(CLIENT_FLAG_DEFAULTS);
  });
});
