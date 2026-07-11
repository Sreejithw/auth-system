import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

export default function Dashboard() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [loggingOut, setLoggingOut] = useState(false);

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
          <div className="user-badge">
            <span className="user-badge-label">Signed in as</span>
            <span className="user-badge-email">{user?.email}</span>
          </div>
        </div>
      </main>
    </div>
  );
}
