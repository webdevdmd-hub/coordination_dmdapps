import { navigation } from '@/config/navigation';
import { PermissionKey } from '@/core/entities/permissions';
import { hasPermission } from '@/lib/permissions';

export const getAccessibleNavHrefs = (permissions: PermissionKey[]) =>
  navigation.flatMap((section) =>
    section.items.filter((item) => hasPermission(permissions, item.permissions)).map((item) => item.href),
  );

export const getFirstAccessiblePath = (
  permissions: PermissionKey[],
  fallbackPath = '/app',
): string => getAccessibleNavHrefs(permissions)[0] ?? fallbackPath;
