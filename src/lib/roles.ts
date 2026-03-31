import { collection, getDocs } from 'firebase/firestore';

import { PermissionKey } from '@/core/entities/permissions';
import { ALL_PERMISSIONS } from '@/core/entities/permissions';
import { getFirebaseDb } from '@/frameworks/firebase/client';
import { normalizeRoleRelations, RoleRelations } from '@/lib/roleVisibility';

export type RoleSummary = {
  id: string;
  key: string;
  name: string;
  permissions: PermissionKey[];
  roleRelations?: RoleRelations;
};

const permissionSet = new Set<PermissionKey>();

export const toPermissions = (value: unknown): PermissionKey[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  if (permissionSet.size === 0) {
    ALL_PERMISSIONS.forEach((permission) => permissionSet.add(permission));
  }
  return value.reduce<PermissionKey[]>((acc, item) => {
    if (typeof item !== 'string') {
      return acc;
    }
    const normalized = item === 'accounts' ? 'sales_order' : item;
    const resolved =
      normalized === 'po_request_create'
        ? 'sales_order_request_create'
        : normalized === 'po_request_view'
          ? 'sales_order_request_view'
          : normalized === 'po_request_approve'
            ? 'sales_order_request_approve'
            : normalized === 'lead_view_department'
              ? 'lead_view_same_role'
              : normalized === 'calendar_view_department'
                ? 'calendar_view_same_role'
                : normalized === 'task_view_department'
                  ? 'task_view_same_role'
                  : normalized === 'customer_view_department'
                    ? 'customer_view_same_role'
                    : normalized === 'project_view_department'
                      ? 'project_view_same_role'
                      : normalized === 'quotation_view_department'
                        ? 'quotation_view_same_role'
                        : normalized === 'quotation_request_view_department'
                          ? 'quotation_request_view_same_role'
                          : normalized;
    if (permissionSet.has(resolved as PermissionKey)) {
      acc.push(resolved as PermissionKey);
    }
    return acc;
  }, []);
};

export const fetchRoleSummaries = async (): Promise<RoleSummary[]> => {
  const snapshot = await getDocs(collection(getFirebaseDb(), 'roles'));
  return snapshot.docs.map((docSnap) => {
    const data = docSnap.data() as {
      key?: string;
      name?: string;
      permissions?: PermissionKey[];
      roleRelations?: unknown;
    };
    const key = typeof data.key === 'string' ? data.key : docSnap.id;
    const name = typeof data.name === 'string' ? data.name : key;
    return {
      id: docSnap.id,
      key,
      name,
      permissions: toPermissions(data.permissions),
      roleRelations: normalizeRoleRelations(data.roleRelations),
    };
  });
};
