import { PermissionKey } from '@/core/entities/permissions';
import { User } from '@/core/entities/user';

export const hasDepartmentScope = (
  permissions: PermissionKey[],
  departmentPermission: PermissionKey,
) => permissions.includes('admin') || permissions.includes(departmentPermission);

export const getDepartmentUserIds = (
  currentUser: Pick<User, 'id' | 'departmentId'> | null,
  users: Array<Pick<User, 'id' | 'departmentId' | 'active'>>,
) => {
  if (!currentUser) {
    return new Set<string>();
  }
  const departmentId = (currentUser.departmentId ?? '').trim().toLowerCase();
  const ids = new Set<string>([currentUser.id]);
  if (!departmentId) {
    return ids;
  }
  users.forEach((entry) => {
    const entryDepartmentId = (entry.departmentId ?? '').trim().toLowerCase();
    if (entry.active !== false && entryDepartmentId === departmentId) {
      ids.add(entry.id);
    }
  });
  return ids;
};

