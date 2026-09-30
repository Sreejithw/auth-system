export const PERMISSIONS = {
  SETTINGS_READ: 'settings:read',
  SETTINGS_UPDATE: 'settings:update',
  USERS_READ: 'users:read',
  USERS_ROLES_UPDATE: 'users:roles:update',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];
