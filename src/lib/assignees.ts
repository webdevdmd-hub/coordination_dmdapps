import { PermissionKey } from '@/core/entities/permissions';
import { User } from '@/core/entities/user';
import { RoleSummary } from '@/lib/roles';

export const filterAssignableUsers = (
  users: User[],
  roles: RoleSummary[],
  requiredPermission: PermissionKey,
  options?: {
    currentUser?: Pick<User, 'id' | 'role'> | null;
    allowOtherDepartments?: boolean;
    allowedDepartmentIds?: string[];
  },
) => {
  const roleMap = new Map<string, RoleSummary>();
  const currentUser = options?.currentUser ?? null;
  const allowOtherDepartments = options?.allowOtherDepartments ?? true;
  const scopedDepartmentIds = new Set(
    (options?.allowedDepartmentIds ?? [])
      .map((item) => item.trim().toLowerCase())
      .filter((item) => item.length > 0),
  );
  const currentRoleKey = (currentUser?.role ?? '').trim().toLowerCase();
  roles.forEach((role) => {
    roleMap.set(role.key.trim().toLowerCase(), role);
  });
  return users.filter((user) => {
    if (!user.active) {
      return false;
    }
    const role = roleMap.get(user.role?.trim().toLowerCase());
    if (!role) {
      return false;
    }
    if (role.permissions.includes('admin')) {
      return true;
    }
    if (!role.permissions.includes(requiredPermission)) {
      return false;
    }
    if (allowOtherDepartments) {
      if (scopedDepartmentIds.size === 0) {
        return true;
      }
      if (currentUser && user.id === currentUser.id) {
        return true;
      }
      const userRoleKey = (user.role ?? '').trim().toLowerCase();
      return scopedDepartmentIds.has(userRoleKey);
    }
    if (!currentUser) {
      return false;
    }
    if (user.id === currentUser.id) {
      return true;
    }
    if (!currentRoleKey) {
      return false;
    }
    const userRoleKey = (user.role ?? '').trim().toLowerCase();
    return userRoleKey === currentRoleKey;
  });
};
