import { collection, getDocs } from 'firebase/firestore';

import { PermissionKey } from '@/core/entities/permissions';
import { getFirebaseDb } from '@/frameworks/firebase/client';

export type RoleSummary = {
  id: string;
  key: string;
  name: string;
  permissions: PermissionKey[];
};

const permissionSet = new Set<PermissionKey>();

export const toPermissions = (value: unknown): PermissionKey[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  if (permissionSet.size === 0) {
    (
      [
        'admin',
        'lead_create',
        'lead_view',
        'lead_view_all',
        'lead_edit',
        'lead_delete',
        'lead_source_manage',
        'calendar_create',
        'calendar_view',
        'calendar_view_all',
        'calendar_edit',
        'calendar_delete',
        'reports_view',
        'dashboard',
        'crm',
        'tasks',
        'task_create',
        'task_view',
        'task_view_all',
        'task_edit',
        'task_delete',
        'task_assign',
        'customer_create',
        'customer_view',
        'customer_view_all',
        'customer_edit',
        'customer_delete',
        'customer_assign',
        'project_create',
        'project_view',
        'project_view_all',
        'project_edit',
        'project_delete',
        'project_assign',
        'quotation_create',
        'quotation_view',
        'quotation_view_all',
        'quotation_edit',
        'quotation_delete',
        'quotation_assign',
        'quotation_request_create',
        'quotation_request_view',
        'quotation_request_view_all',
        'quotation_request_edit',
        'quotation_request_delete',
        'quotation_request_assign',
        'po_request_create',
        'po_request_view',
        'po_request_approve',
        'calendar_assign',
        'invoices_view',
        'sales',
        'operations',
        'accounts',
        'store',
        'procurement',
        'logistics',
        'marketing',
        'fleet',
        'compliance',
        'settings',
      ] as PermissionKey[]
    ).forEach((permission) => permissionSet.add(permission));
  }
  return value.filter(
    (item): item is PermissionKey =>
      typeof item === 'string' && permissionSet.has(item as PermissionKey),
  );
};

export const fetchRoleSummaries = async (): Promise<RoleSummary[]> => {
  const snapshot = await getDocs(collection(getFirebaseDb(), 'roles'));
  return snapshot.docs.map((docSnap) => {
    const data = docSnap.data() as { key?: string; name?: string; permissions?: PermissionKey[] };
    const key = typeof data.key === 'string' ? data.key : docSnap.id;
    const name = typeof data.name === 'string' ? data.name : key;
    return {
      id: docSnap.id,
      key,
      name,
      permissions: toPermissions(data.permissions),
    };
  });
};
