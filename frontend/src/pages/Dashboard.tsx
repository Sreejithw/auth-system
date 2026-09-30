import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { getRuntimeConfig } from '../config/runtimeConfig';
import { useFlag } from '../flags/FlagContext';
import MfaSecurity from '../components/MfaSecurity';

function formatExpiry(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString();
}

export default function Dashboard() {
  const { user, isAdmin, session, logout } = useAuth();
  const navigate = useNavigate();
  const [loggingOut, setLoggingOut] = useState(false);
  const { version, gitSha } = getRuntimeConfig();
  const showNewDashboardMessage = useFlag('new-dashboard-rollout');
  const idleLabel = formatExpiry(session?.idleExpiresAt);
  const absoluteLabel = formatExpiry(session?.absoluteExpiresAt);

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await logout();
      navigate('/login', { replace: true });
    } finally {
      setLoggingOut(false);
    }
  }

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <span className="brand">Auth System</span>
        <div className="header-nav">
          {isAdmin && (
            <Link to="/admin/settings" className="btn btn-ghost">
              Settings
            </Link>
          )}
          <button
            type="button"
            className="btn btn-ghost"
            onClick={handleLogout}
            disabled={loggingOut}
          >
            {loggingOut ? 'Signing out…' : 'Log out'}
          </button>
        </div>
      </header>

      <main className="dashboard-main">
        <div className="dashboard-card">
          <h1 className="auth-title">Dashboard</h1>
          <p className="auth-subtitle">You are signed in.</p>
          {showNewDashboardMessage && (
            <p className="auth-subtitle">A refreshed dashboard experience is on the way.</p>
          )}
          <div className="user-badge">
            <span className="user-badge-label">Signed in as</span>
            <span className="user-badge-email">{user?.email}</span>
          </div>
          {(idleLabel || absoluteLabel) && (
            <div className="session-expiry">
              {idleLabel && (
                <p className="field-hint">Idle session expires: {idleLabel}</p>
              )}
              {absoluteLabel && (
                <p className="field-hint">Absolute session expires: {absoluteLabel}</p>
              )}
            </div>
          )}
          <MfaSecurity />
        </div>
      </main>
      <footer className="build-info">
        Version {version} · {gitSha.slice(0, 7)}
      </footer>
    </div>
  );
}
