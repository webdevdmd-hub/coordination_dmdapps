import { PermissionKey } from '@/core/entities/permissions';

export const hasPermission = (permissions: PermissionKey[], required?: PermissionKey[]) => {
  if (!required || required.length === 0) {
    return true;
  }
  return required.some((permission) => permissions.includes(permission));
};
