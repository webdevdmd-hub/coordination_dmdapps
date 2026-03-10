import { NextResponse } from 'next/server';

import { ALL_PERMISSIONS } from '@/core/entities/permissions';
import type { PermissionKey } from '@/core/entities/permissions';
import { getFirebaseAdminDb } from '@/frameworks/firebase/admin';
import { getAuthedUserFromSession } from '@/lib/auth/serverSession';

export const runtime = 'nodejs';

type CreateRoleRequest = {
  name: string;
  description?: string;
};

type UpdateRoleRequest = {
  id: string;
  permissions?: PermissionKey[];
  name?: string;
  description?: string;
  departmentScope?: {
    viewUsersDepartmentIds?: string[];
    assignTasksDepartmentIds?: string[];
  };
};

const toErrorResponse = (message: string, status = 400) =>
  NextResponse.json({ error: message }, { status });

const requireAdmin = async (request: Request) => {
  const authedUser = await getAuthedUserFromSession(request);
  if (!authedUser) {
    return toErrorResponse('Unauthorized.', 401);
  }
  if (!authedUser.active) {
    return toErrorResponse('Your account is inactive.', 403);
  }
  if (!authedUser.permissions.includes('admin')) {
    return toErrorResponse('Forbidden.', 403);
  }
  return null;
};

const toRoleKey = (name: string) =>
  name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const ADMIN_ROLE_KEY = 'admin';
const normalizePermission = (permission: string) =>
  permission === 'accounts'
    ? 'sales_order'
    : permission === 'po_request_create'
      ? 'sales_order_request_create'
      : permission === 'po_request_view'
        ? 'sales_order_request_view'
        : permission === 'po_request_approve'
          ? 'sales_order_request_approve'
          : permission;
const toKnownPermissions = (permissions: unknown): PermissionKey[] =>
  Array.from(
    new Set(
      Array.isArray(permissions)
        ? permissions
            .filter((permission): permission is string => typeof permission === 'string')
            .map((permission) => normalizePermission(permission))
            .filter(
              (permission): permission is PermissionKey =>
                ALL_PERMISSIONS.includes(permission as PermissionKey),
            )
        : [],
    ),
  );

const toDepartmentIds = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return Array.from(
    new Set(
      value
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter((item) => item.length > 0),
    ),
  );
};

export async function GET(request: Request) {
  const authError = await requireAdmin(request);
  if (authError) {
    return authError;
  }

  const db = getFirebaseAdminDb();

  try {
    const snapshot = await db.collection('roles').orderBy('name').get();
    const roles = snapshot.docs.map((doc) => {
      const data = doc.data() as Record<string, unknown>;
      if (data.key === ADMIN_ROLE_KEY) {
        return {
          id: doc.id,
          ...data,
          permissions: ALL_PERMISSIONS,
          departmentScope: {
            viewUsersDepartmentIds: undefined,
            assignTasksDepartmentIds: undefined,
          },
        };
      }
      return {
        id: doc.id,
        ...data,
        permissions: toKnownPermissions(data.permissions),
        departmentScope: {
          viewUsersDepartmentIds: toDepartmentIds(
            (data.departmentScope as { viewUsersDepartmentIds?: unknown } | undefined)
              ?.viewUsersDepartmentIds,
          ),
          assignTasksDepartmentIds: toDepartmentIds(
            (data.departmentScope as { assignTasksDepartmentIds?: unknown } | undefined)
              ?.assignTasksDepartmentIds,
          ),
        },
      };
    });
    return NextResponse.json({ roles }, { status: 200, headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return toErrorResponse('Unable to load roles.', 500);
  }
}

export async function POST(request: Request) {
  const authError = await requireAdmin(request);
  if (authError) {
    return authError;
  }

  let payload: CreateRoleRequest;
  try {
    payload = (await request.json()) as CreateRoleRequest;
  } catch {
    return toErrorResponse('Invalid JSON payload.');
  }

  if (!payload.name?.trim()) {
    return toErrorResponse('Role name is required.');
  }

  const name = payload.name.trim();
  const key = toRoleKey(name);
  const description =
    typeof payload.description === 'string' && payload.description.trim().length > 0
      ? payload.description.trim()
      : undefined;
  if (!key) {
    return toErrorResponse('Role name is invalid.');
  }

  const db = getFirebaseAdminDb();

  try {
    const existing = await db.collection('roles').where('key', '==', key).get();
    if (!existing.empty) {
      return toErrorResponse('Role already exists.');
    }

    const payload: Record<string, unknown> = {
      key,
      name,
      permissions: [],
      createdAt: new Date().toISOString(),
    };
    if (description) {
      payload.description = description;
    }
    const docRef = await db.collection('roles').add(payload);

    return NextResponse.json({ id: docRef.id }, { status: 201 });
  } catch {
    return toErrorResponse('Unable to create role.', 500);
  }
}

export async function PATCH(request: Request) {
  const authError = await requireAdmin(request);
  if (authError) {
    return authError;
  }

  let payload: UpdateRoleRequest;
  try {
    payload = (await request.json()) as UpdateRoleRequest;
  } catch {
    return toErrorResponse('Invalid JSON payload.');
  }

  if (!payload.id) {
    return toErrorResponse('Role id is required.');
  }

  if (payload.permissions !== undefined && !Array.isArray(payload.permissions)) {
    return toErrorResponse('Permissions must be an array.');
  }
  if (payload.departmentScope !== undefined && typeof payload.departmentScope !== 'object') {
    return toErrorResponse('Department scope must be an object.');
  }

  const updates: Record<string, unknown> = {};
  if (typeof payload.name === 'string') {
    const name = payload.name.trim();
    if (!name) {
      return toErrorResponse('Role name is required.');
    }
    const key = toRoleKey(name);
    if (!key) {
      return toErrorResponse('Role name is invalid.');
    }
    updates.name = name;
    updates.key = key;
  }
  if (payload.permissions !== undefined) {
    updates.permissions = toKnownPermissions(payload.permissions);
  }
  if (typeof payload.description === 'string') {
    updates.description = payload.description.trim();
  }
  if (payload.departmentScope !== undefined) {
    updates.departmentScope = {
      viewUsersDepartmentIds: toDepartmentIds(payload.departmentScope.viewUsersDepartmentIds) ?? [],
      assignTasksDepartmentIds:
        toDepartmentIds(payload.departmentScope.assignTasksDepartmentIds) ?? [],
    };
  }
  if (Object.keys(updates).length === 0) {
    return toErrorResponse('No updates provided.');
  }

  const db = getFirebaseAdminDb();

  try {
    const existing = await db.collection('roles').doc(payload.id).get();
    if (!existing.exists) {
      return toErrorResponse('Role not found.', 404);
    }
    const existingData = existing.data() as { key?: string } | undefined;
    if (existingData?.key === ADMIN_ROLE_KEY) {
      return toErrorResponse('Admin role permissions are locked.', 403);
    }
    if (typeof updates.key === 'string') {
      const duplicate = await db
        .collection('roles')
        .where('key', '==', updates.key)
        .limit(2)
        .get();
      const hasAnotherRoleWithSameKey = duplicate.docs.some((doc) => doc.id !== payload.id);
      if (hasAnotherRoleWithSameKey) {
        return toErrorResponse('Role already exists.');
      }
    }
    await db.collection('roles').doc(payload.id).set(updates, { merge: true });
    return NextResponse.json({ id: payload.id }, { status: 200 });
  } catch {
    return toErrorResponse('Unable to update role.', 500);
  }
}
