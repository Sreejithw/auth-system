import { requirePermission } from "./requirePermission.js";
import { PERMISSIONS } from "../services/authorization.service.js";

/**
 * @deprecated Prefer a resource-specific requirePermission(...) guard.
 * Retained as a compatibility alias for operations reserved for full
 * administrators; RBAC, not users.is_admin, is authoritative.
 */
export const requireAdmin = requirePermission(
  PERMISSIONS.USERS_ROLES_UPDATE,
);
