import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import type { AdminRole, AdminUser } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { PERMISSIONS } from '../auth/permissions';

const PAGE_SIZE = 20;

function errorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return 'The request could not be completed.';
  switch (error.code) {
    case 'RECENT_AUTH_REQUIRED':
      return 'Please sign out and sign back in before changing user roles.';
    case 'LAST_ADMINISTRATOR':
      return 'This change would remove the final administrator.';
    case 'SELF_DEMOTION_NOT_ALLOWED':
      return 'You cannot remove your own administrator role.';
    case 'FORBIDDEN':
      return 'Your access has changed. Permissions have been refreshed.';
    default:
      return error.message;
  }
}

export default function AdminUsers() {
  const { hasPermission, refreshSession } = useAuth();
  const canEdit = hasPermission(PERMISSIONS.USERS_ROLES_UPDATE);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [cursor, setCursor] = useState('');
  const [cursorHistory, setCursorHistory] = useState<string[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [roles, setRoles] = useState<AdminRole[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedRoles, setSelectedRoles] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(search.trim());
      setCursor('');
      setCursorHistory([]);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    void api
      .getAdminUsers({
        search: debouncedSearch || undefined,
        limit: PAGE_SIZE,
        cursor: cursor || undefined,
      })
      .then((response) => {
        if (!active) return;
        setUsers(response.users);
        setNextCursor(response.nextCursor);
      })
      .catch(async (err: unknown) => {
        if (!active) return;
        setError(errorMessage(err));
        if (err instanceof ApiError && err.code === 'FORBIDDEN') await refreshSession();
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [cursor, debouncedSearch, refreshKey, refreshSession]);

  useEffect(() => {
    if (!canEdit) {
      setRoles([]);
      setEditingId(null);
      return;
    }
    let active = true;
    void api
      .getAdminRoles()
      .then(({ roles: availableRoles }) => {
        if (active) setRoles(availableRoles);
      })
      .catch(async (err: unknown) => {
        if (!active) return;
        setError(errorMessage(err));
        if (err instanceof ApiError && err.code === 'FORBIDDEN') await refreshSession();
      });
    return () => {
      active = false;
    };
  }, [canEdit, refreshSession]);

  function beginEditing(user: AdminUser) {
    setError(null);
    setSuccess(null);
    setEditingId(user.id);
    setSelectedRoles(user.roles);
  }

  function toggleRole(roleKey: string) {
    if (roleKey === 'user') return;
    setSelectedRoles((current) =>
      current.includes(roleKey)
        ? current.filter((key) => key !== roleKey)
        : [...current, roleKey],
    );
  }

  async function saveRoles(user: AdminUser) {
    const roleKeys = Array.from(new Set(['user', ...selectedRoles]));
    if (
      !window.confirm(
        `Replace roles for ${user.email} with: ${roleKeys.join(', ')}?`,
      )
    ) {
      return;
    }

    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const { user: updated } = await api.updateAdminUserRoles(user.id, roleKeys);
      setUsers((current) =>
        current.map((row) => (row.id === updated.id ? { ...row, roles: updated.roles } : row)),
      );
      setEditingId(null);
      setSuccess(`Roles updated for ${updated.email}.`);
      await refreshSession();
    } catch (err) {
      setError(errorMessage(err));
      if (err instanceof ApiError && err.code === 'FORBIDDEN') await refreshSession();
    } finally {
      setSaving(false);
    }
  }

  function nextPage() {
    if (!nextCursor) return;
    setCursorHistory((current) => [...current, cursor]);
    setCursor(nextCursor);
  }

  function previousPage() {
    setCursorHistory((current) => {
      const previous = current[current.length - 1] ?? '';
      setCursor(previous);
      return current.slice(0, -1);
    });
  }

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <span className="brand">Auth System</span>
        <nav className="header-nav">
          <Link to="/dashboard" className="btn btn-ghost">Dashboard</Link>
        </nav>
      </header>

      <main className="dashboard-main admin-users-main">
        <div className="dashboard-card admin-users-card">
          <div className="admin-users-heading">
            <div>
              <h1 className="auth-title">User Access</h1>
              <p className="auth-subtitle">Search users and review their fixed roles.</p>
            </div>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setRefreshKey((value) => value + 1)}
              disabled={loading}
            >
              Refresh
            </button>
          </div>

          {!canEdit && (
            <div className="alert alert-info">You have read-only access to user roles.</div>
          )}
          {error && <div className="alert alert-error" role="alert">{error}</div>}
          {success && <div className="alert alert-success">{success}</div>}

          <label className="field user-search">
            <span className="field-label">Search users</span>
            <input
              className="field-input"
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Email address"
            />
          </label>

          {loading ? (
            <div className="users-loading"><div className="spinner" aria-label="Loading users" /></div>
          ) : users.length === 0 ? (
            <p className="empty-state">No users found.</p>
          ) : (
            <div className="users-list">
              {users.map((user) => {
                const editing = editingId === user.id;
                return (
                  <section className="user-access-row" key={user.id}>
                    <div className="user-access-summary">
                      <div>
                        <strong>{user.email}</strong>
                        <span className="field-hint">
                          Joined {new Date(user.createdAt).toLocaleDateString()}
                        </span>
                      </div>
                      <div className="role-badges">
                        {user.roles.map((role) => <span className="role-badge" key={role}>{role}</span>)}
                      </div>
                      {canEdit && !editing && (
                        <button type="button" className="btn btn-ghost" onClick={() => beginEditing(user)}>
                          Edit roles
                        </button>
                      )}
                    </div>

                    {editing && (
                      <div className="role-editor">
                        {roles.map((role) => (
                          <label className="role-option" key={role.key}>
                            <input
                              type="checkbox"
                              checked={role.key === 'user' || selectedRoles.includes(role.key)}
                              disabled={role.key === 'user' || saving}
                              onChange={() => toggleRole(role.key)}
                            />
                            <span>
                              <strong>{role.name}</strong>
                              <span className="field-hint">{role.description}</span>
                            </span>
                          </label>
                        ))}
                        <div className="button-row">
                          <button type="button" className="btn btn-primary" disabled={saving} onClick={() => void saveRoles(user)}>
                            {saving ? 'Saving…' : 'Save roles'}
                          </button>
                          <button type="button" className="btn btn-ghost" disabled={saving} onClick={() => setEditingId(null)}>
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </section>
                );
              })}
            </div>
          )}

          <div className="pagination">
            <button type="button" className="btn btn-ghost" onClick={previousPage} disabled={loading || cursorHistory.length === 0}>
              Previous
            </button>
            <span className="field-hint">Page {cursorHistory.length + 1}</span>
            <button type="button" className="btn btn-ghost" onClick={nextPage} disabled={loading || !nextCursor}>
              Next
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
