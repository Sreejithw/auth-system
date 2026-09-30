import { Navigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuth } from '../auth/AuthContext';

export default function PendingMfaRoute({ children }: { children: ReactNode }) {
  const { loading, pendingMfa, user } = useAuth();

  if (loading) {
    return (
      <div className="center-screen">
        <div className="spinner" aria-label="Loading" />
      </div>
    );
  }

  if (!pendingMfa || user) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}
