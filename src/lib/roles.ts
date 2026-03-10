import { collection, getDocs } from 'firebase/firestore';

import { PermissionKey } from '@/core/entities/permissions';
import { ALL_PERMISSIONS } from '@/core/entities/permissions';
import { getFirebaseDb } from '@/frameworks/firebase/client';

export type RoleSummary = {
  id: string;
  key: string;
  name: string;
  permissions: PermissionKey[];
  departmentScope?: {
    viewUsersDepartmentIds?: string[];
    assignTasksDepartmentIds?: string[];
  };
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
      departmentScope?: {
        viewUsersDepartmentIds?: unknown;
        assignTasksDepartmentIds?: unknown;
      };
    };
    const key = typeof data.key === 'string' ? data.key : docSnap.id;
    const name = typeof data.name === 'string' ? data.name : key;
    const viewUsersDepartmentIds = Array.isArray(data.departmentScope?.viewUsersDepartmentIds)
      ? data.departmentScope?.viewUsersDepartmentIds
          .filter((item): item is string => typeof item === 'string')
          .map((item) => item.trim())
          .filter((item) => item.length > 0)
      : undefined;
    const assignTasksDepartmentIds = Array.isArray(data.departmentScope?.assignTasksDepartmentIds)
      ? data.departmentScope?.assignTasksDepartmentIds
          .filter((item): item is string => typeof item === 'string')
          .map((item) => item.trim())
          .filter((item) => item.length > 0)
      : undefined;
    return {
      id: docSnap.id,
      key,
      name,
      permissions: toPermissions(data.permissions),
      departmentScope: {
        viewUsersDepartmentIds,
        assignTasksDepartmentIds,
      },
    };
  });
};
