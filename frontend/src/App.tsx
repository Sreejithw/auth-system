import { Navigate, Route, Routes } from 'react-router-dom';
import ProtectedRoute from './components/ProtectedRoute';
import PendingMfaRoute from './components/PendingMfaRoute';
import PermissionRoute from './components/PermissionRoute';
import Login from './pages/Login';
import Register from './pages/Register';
import Dashboard from './pages/Dashboard';
import MfaVerify from './pages/MfaVerify';
import AdminSettings from './pages/AdminSettings';
import AdminUsers from './pages/AdminUsers';
import { PERMISSIONS } from './auth/permissions';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route
        path="/mfa/verify"
        element={
          <PendingMfaRoute>
            <MfaVerify />
          </PendingMfaRoute>
        }
      />
      <Route
        path="/dashboard"
        element={
          <ProtectedRoute>
            <Dashboard />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/settings"
        element={
          <PermissionRoute permission={PERMISSIONS.SETTINGS_READ}>
            <AdminSettings />
          </PermissionRoute>
        }
      />
      <Route
        path="/admin/users"
        element={
          <PermissionRoute permission={PERMISSIONS.USERS_READ}>
            <AdminUsers />
          </PermissionRoute>
        }
      />
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
