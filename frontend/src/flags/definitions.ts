export const CLIENT_FLAG_DEFAULTS = {
  'new-registration-flow': false,
  'new-dashboard-rollout': false,
} as const;

export type ClientFlagKey = keyof typeof CLIENT_FLAG_DEFAULTS;
export type ClientFlags = Record<ClientFlagKey, boolean>;

export function parseClientFlags(value: unknown): ClientFlags {
  if (typeof value !== 'object' || value === null) {
    return { ...CLIENT_FLAG_DEFAULTS };
  }

  const candidate = value as Record<string, unknown>;
  return {
    'new-registration-flow':
      typeof candidate['new-registration-flow'] === 'boolean'
        ? candidate['new-registration-flow']
        : CLIENT_FLAG_DEFAULTS['new-registration-flow'],
    'new-dashboard-rollout':
      typeof candidate['new-dashboard-rollout'] === 'boolean'
        ? candidate['new-dashboard-rollout']
        : CLIENT_FLAG_DEFAULTS['new-dashboard-rollout'],
  };
}
