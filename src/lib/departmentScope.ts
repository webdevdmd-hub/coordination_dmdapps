import { PermissionKey } from '@/core/entities/permissions';
import { User } from '@/core/entities/user';

export const hasDepartmentScope = (
  permissions: PermissionKey[],
  departmentPermission: PermissionKey,
) => permissions.includes('admin') || permissions.includes(departmentPermission);

export const getDepartmentUserIds = (
  currentUser: Pick<User, 'id' | 'role'> | null,
  users: Array<Pick<User, 'id' | 'role' | 'active'>>,
) => {
  if (!currentUser) {
    return new Set<string>();
  }
  const roleKey = (currentUser.role ?? '').trim().toLowerCase();
  const ids = new Set<string>([currentUser.id]);
  if (!roleKey) {
    return ids;
  }
  users.forEach((entry) => {
    const entryRoleKey = (entry.role ?? '').trim().toLowerCase();
    if (entry.active !== false && entryRoleKey === roleKey) {
      ids.add(entry.id);
    }
  });
  return ids;
};

export const filterUsersByDepartmentScope = <T extends Pick<User, 'id' | 'role' | 'active'>>(
  currentUser: Pick<User, 'id' | 'role'> | null,
  users: T[],
  allowOtherDepartments: boolean,
  allowedDepartmentIds?: string[],
) => {
  const activeUsers = users.filter((entry) => entry.active !== false);
  if (allowOtherDepartments) {
    const scopedDepartmentIds = new Set(
      (allowedDepartmentIds ?? [])
        .map((item) => item.trim().toLowerCase())
        .filter((item) => item.length > 0),
    );
    if (scopedDepartmentIds.size === 0) {
      return activeUsers;
    }
    if (!currentUser) {
      return activeUsers.filter((entry) => {
        const entryRoleKey = (entry.role ?? '').trim().toLowerCase();
        return scopedDepartmentIds.has(entryRoleKey);
      });
    }
    return activeUsers.filter((entry) => {
      if (entry.id === currentUser.id) {
        return true;
      }
      const entryRoleKey = (entry.role ?? '').trim().toLowerCase();
      return scopedDepartmentIds.has(entryRoleKey);
    });
  }
  if (!currentUser) {
    return [];
  }
  const roleKey = (currentUser.role ?? '').trim().toLowerCase();
  if (!roleKey) {
    return activeUsers.filter((entry) => entry.id === currentUser.id);
  }
  return activeUsers.filter((entry) => {
    if (entry.id === currentUser.id) {
      return true;
    }
    const entryRoleKey = (entry.role ?? '').trim().toLowerCase();
    return entryRoleKey === roleKey;
  });
};

