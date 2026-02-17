import { PermissionKey } from '@/core/entities/permissions';
import { User } from '@/core/entities/user';
import { RoleSummary } from '@/lib/roles';

export const filterAssignableUsers = (
  users: User[],
  roles: RoleSummary[],
  requiredPermission: PermissionKey,
) => {
  const roleMap = new Map<string, RoleSummary>();
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
    return role.permissions.includes(requiredPermission);
  });
};
