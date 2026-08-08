export const FLAG_DEFINITIONS = {
  "new-registration-flow": {
    defaultValue: false,
    clientSafe: true,
    category: "release",
    description:
      "Shows the optional new registration experience. False keeps the current flow.",
  },
  "registration-enabled": {
    defaultValue: true,
    clientSafe: false,
    category: "operational",
    description:
      "Authoritatively permits registration. True preserves current availability.",
  },
  "new-dashboard-rollout": {
    defaultValue: false,
    clientSafe: true,
    category: "release",
    description:
      "Shows harmless dashboard rollout content. False keeps the current dashboard.",
  },
} as const;

export type FlagKey = keyof typeof FLAG_DEFINITIONS;

export type ClientFlagKey = {
  [Key in FlagKey]: (typeof FLAG_DEFINITIONS)[Key]["clientSafe"] extends true
    ? Key
    : never;
}[FlagKey];

export type ClientFlags = Record<ClientFlagKey, boolean>;

export const CLIENT_FLAG_KEYS = Object.entries(FLAG_DEFINITIONS)
  .filter(([, definition]) => definition.clientSafe)
  .map(([key]) => key as ClientFlagKey);

export const CLIENT_FLAG_DEFAULTS = Object.fromEntries(
  CLIENT_FLAG_KEYS.map((key) => [key, FLAG_DEFINITIONS[key].defaultValue]),
) as ClientFlags;
