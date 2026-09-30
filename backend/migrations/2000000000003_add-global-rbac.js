/**
 * Additive, idempotent global RBAC schema and fixed catalog.
 * users.is_admin is intentionally retained for rollback compatibility.
 */
export const shorthands = undefined;

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export const up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS roles (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      key text UNIQUE NOT NULL,
      name text NOT NULL,
      description text NOT NULL,
      is_system boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS permissions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      key text UNIQUE NOT NULL,
      description text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS role_permissions (
      role_id uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
      permission_id uuid NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
      PRIMARY KEY (role_id, permission_id)
    );

    CREATE TABLE IF NOT EXISTS user_roles (
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role_id uuid NOT NULL REFERENCES roles(id),
      assigned_at timestamptz NOT NULL DEFAULT now(),
      assigned_by uuid REFERENCES users(id) ON DELETE SET NULL,
      PRIMARY KEY (user_id, role_id)
    );

    CREATE INDEX IF NOT EXISTS user_roles_user_id_idx ON user_roles(user_id);
    CREATE INDEX IF NOT EXISTS user_roles_role_id_idx ON user_roles(role_id);

    CREATE TABLE IF NOT EXISTS authorization_audit_events (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
      target_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
      action text NOT NULL,
      outcome text NOT NULL CHECK (outcome IN ('success', 'denied')),
      before_roles jsonb NOT NULL DEFAULT '[]'::jsonb,
      after_roles jsonb NOT NULL DEFAULT '[]'::jsonb,
      reason text,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS authorization_audit_actor_idx
      ON authorization_audit_events(actor_user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS authorization_audit_target_idx
      ON authorization_audit_events(target_user_id, created_at DESC);

    INSERT INTO permissions (key, description) VALUES
      ('settings:read', 'Read database-backed application settings'),
      ('settings:update', 'Update application settings'),
      ('users:read', 'Search users and view their assigned roles'),
      ('users:roles:update', 'Replace a user''s assigned roles')
    ON CONFLICT (key) DO UPDATE SET description = EXCLUDED.description;

    INSERT INTO roles (key, name, description, is_system) VALUES
      ('user', 'User', 'Base role assigned to every account', true),
      ('support', 'Support', 'Read-only user support access', true),
      ('settings-manager', 'Settings Manager', 'Manage operational application settings', true),
      ('administrator', 'Administrator', 'Full application administration', true)
    ON CONFLICT (key) DO UPDATE SET
      name = EXCLUDED.name,
      description = EXCLUDED.description,
      is_system = true;

    INSERT INTO role_permissions (role_id, permission_id)
    SELECT r.id, p.id
    FROM roles r
    JOIN permissions p ON
      (r.key = 'support' AND p.key = 'users:read')
      OR (r.key = 'settings-manager' AND p.key IN ('settings:read', 'settings:update'))
      OR (r.key = 'administrator')
    WHERE r.key IN ('support', 'settings-manager', 'administrator')
      AND p.key IN ('settings:read', 'settings:update', 'users:read', 'users:roles:update')
    ON CONFLICT DO NOTHING;

    INSERT INTO user_roles (user_id, role_id)
    SELECT u.id, r.id FROM users u CROSS JOIN roles r WHERE r.key = 'user'
    ON CONFLICT DO NOTHING;

    INSERT INTO user_roles (user_id, role_id)
    SELECT u.id, r.id
    FROM users u CROSS JOIN roles r
    WHERE r.key = 'administrator' AND u.is_admin = true
    ON CONFLICT DO NOTHING;
  `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export const down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS authorization_audit_events;
    DROP TABLE IF EXISTS user_roles;
    DROP TABLE IF EXISTS role_permissions;
    DROP TABLE IF EXISTS permissions;
    DROP TABLE IF EXISTS roles;
  `);
};
