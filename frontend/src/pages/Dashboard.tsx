import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { getRuntimeConfig } from '../config/runtimeConfig';
import { useFlag } from '../flags/FlagContext';

export default function Dashboard() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [loggingOut, setLoggingOut] = useState(false);
  const { version, gitSha } = getRuntimeConfig();
  const showNewDashboardMessage = useFlag('new-dashboard-rollout');

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
        <button
          type="button"
          className="btn btn-ghost"
          onClick={handleLogout}
          disabled={loggingOut}
        >
          {loggingOut ? 'Signing out…' : 'Log out'}
        </button>
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
        </div>
      </main>
      <footer className="build-info">
        Version {version} · {gitSha.slice(0, 7)}
      </footer>
    </div>
  );
}
