import { PermissionKey } from '@/core/entities/permissions';
import { User } from '@/core/entities/user';
import { RoleSummary } from '@/lib/roles';
import { canAssignAcrossRoles, RoleRelationModuleKey } from '@/lib/roleVisibility';

export const filterAssignableUsers = (
  users: User[],
  roles: RoleSummary[],
  requiredPermission: PermissionKey,
  options?: {
    currentUser?: Pick<User, 'id' | 'role'> | null;
    moduleKey?: RoleRelationModuleKey;
  },
) => {
  const roleMap = new Map<string, RoleSummary>();
  const currentUser = options?.currentUser ?? null;
  const moduleKey = options?.moduleKey;
  const currentRoleKey = (currentUser?.role ?? '').trim().toLowerCase();
  roles.forEach((role) => {
    roleMap.set(role.key.trim().toLowerCase(), role);
  });
  const currentRole = currentRoleKey ? roleMap.get(currentRoleKey) : null;
  const currentRoleIsAdmin = Boolean(currentRole?.permissions.includes('admin'));
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
    if (!currentUser) {
      return false;
    }
    if (user.id === currentUser.id) {
      return true;
    }
    if (!currentRoleKey) {
      return false;
    }
    if (currentRoleIsAdmin) {
      return true;
    }
    const userRoleKey = (user.role ?? '').trim().toLowerCase();
    if (!moduleKey) {
      return false;
    }
    return canAssignAcrossRoles(
      currentRoleKey,
      userRoleKey,
      moduleKey,
      currentRole?.roleRelations,
      role.roleRelations,
    );
  });
};
