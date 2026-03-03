import { NextResponse } from 'next/server';

import { ALL_PERMISSIONS, PermissionKey } from '@/core/entities/permissions';
import { getFirebaseAdminDb } from '@/frameworks/firebase/admin';
import { getAuthedUserFromSession } from '@/lib/auth/serverSession';

export const runtime = 'nodejs';

type CreateSalesOrderRequestPayload = {
  projectId?: string;
  estimateNumber?: string;
  estimateAmount?: number;
  salesOrderNumber?: string;
  salesOrderAmount?: number;
  salesOrderDate?: string;
};

const SALES_NAMESPACE_ID = 'main';
const SALES_ORDER_NAMESPACE_ID = 'main';

const toErrorResponse = (message: string, status = 400) =>
  NextResponse.json({ error: message }, { status });

const toFiniteNumber = (value: unknown) => {
  if (typeof value !== 'number' || Number.isNaN(value) || !Number.isFinite(value)) {
    return null;
  }
  return value;
};

const roundAmount = (value: number) => Math.round(value * 100) / 100;

const resolveRolePermissions = async (
  roleKey: string,
  cache: Map<string, PermissionKey[]>,
): Promise<PermissionKey[]> => {
  const normalized = roleKey.trim().toLowerCase();
  if (!normalized) {
    return [];
  }
  if (normalized === 'admin') {
    return ALL_PERMISSIONS;
  }
  const cached = cache.get(normalized);
  if (cached) {
    return cached;
  }

  const db = getFirebaseAdminDb();
  const byKey = await db.collection('roles').where('key', '==', normalized).limit(1).get();
  if (!byKey.empty) {
    const permissions = ((byKey.docs[0]?.data().permissions ?? []) as PermissionKey[]).filter(
      (permission) => ALL_PERMISSIONS.includes(permission),
    );
    cache.set(normalized, permissions);
    return permissions;
  }

  const byId = await db.collection('roles').doc(normalized).get();
  if (byId.exists) {
    const permissions = (((byId.data()?.permissions as PermissionKey[]) ?? []) as PermissionKey[]).filter(
      (permission) => ALL_PERMISSIONS.includes(permission),
    );
    cache.set(normalized, permissions);
    return permissions;
  }

  cache.set(normalized, []);
  return [];
};

const buildRequestNo = (id: string, nowIso: string) => {
  const ymd = nowIso.slice(0, 10).replace(/-/g, '');
  return `SOR-${ymd}-${id.slice(0, 6).toUpperCase()}`;
};

export async function POST(request: Request) {
  let payload: CreateSalesOrderRequestPayload;
  try {
    payload = (await request.json()) as CreateSalesOrderRequestPayload;
  } catch {
    return toErrorResponse('Invalid JSON payload.');
  }

  const authedUser = await getAuthedUserFromSession(request);
  if (!authedUser) {
    return toErrorResponse('Unauthorized.', 401);
  }
  if (!authedUser.active) {
    return toErrorResponse('Your account is inactive.', 403);
  }

  const permissionCache = new Map<string, PermissionKey[]>();
  const requesterPermissions = authedUser.permissions;
  const canCreate =
    requesterPermissions.includes('admin') ||
    requesterPermissions.includes('sales_order_request_create') ||
    requesterPermissions.includes('sales_order_request_create');
  if (!canCreate) {
    return toErrorResponse('You do not have permission to create Sales Order Reqs.', 403);
  }

  const projectId = payload.projectId?.trim();
  const estimateNumber = payload.estimateNumber?.trim();
  const salesOrderNumber = payload.salesOrderNumber?.trim();
  const salesOrderDate = payload.salesOrderDate?.trim();
  const estimateAmount = toFiniteNumber(payload.estimateAmount);
  const salesOrderAmount = toFiniteNumber(payload.salesOrderAmount);
  if (!projectId) {
    return toErrorResponse('Project id is required.');
  }
  if (!estimateNumber) {
    return toErrorResponse('Estimate number is required.');
  }
  if (estimateAmount === null || estimateAmount <= 0) {
    return toErrorResponse('Estimate amount must be greater than 0.');
  }
  if (!salesOrderNumber) {
    return toErrorResponse('Sales Order number is required.');
  }
  if (salesOrderAmount === null || salesOrderAmount <= 0) {
    return toErrorResponse('Sales Order amount must be greater than 0.');
  }
  if (!salesOrderDate) {
    return toErrorResponse('Sales Order date is required.');
  }

  const db = getFirebaseAdminDb();
  const projectRef = db.collection('sales').doc(SALES_NAMESPACE_ID).collection('projects').doc(projectId);
  const projectSnap = await projectRef.get();
  if (!projectSnap.exists) {
    return toErrorResponse('Project not found.', 404);
  }
  const projectData = projectSnap.data() as Record<string, unknown>;

  const canViewAllProjects =
    requesterPermissions.includes('admin') || requesterPermissions.includes('project_view_all');
  const isOwner = String(projectData.assignedTo ?? '') === authedUser.id;
  if (!canViewAllProjects && !isOwner) {
    return toErrorResponse('You can only submit Sales Order Reqs for your assigned projects.', 403);
  }

  const now = new Date().toISOString();
  const salesOrderRef = db
    .collection('sales_order')
    .doc(SALES_ORDER_NAMESPACE_ID)
    .collection('sales_order_requests')
    .doc();
  const requestNo = buildRequestNo(salesOrderRef.id, now);

  const usersSnap = await db.collection('users').where('active', '==', true).get();
  const approverIds: string[] = [];
  for (const userDoc of usersSnap.docs) {
    if (userDoc.id === authedUser.id) {
      continue;
    }
    const userData = userDoc.data() as { role?: string };
    const roleKey = String(userData.role ?? '').trim().toLowerCase();
    if (!roleKey) {
      continue;
    }
    const perms = await resolveRolePermissions(roleKey, permissionCache);
    if (
      perms.includes('admin') ||
      perms.includes('sales_order_request_approve') ||
      perms.includes('sales_order_request_approve')
    ) {
      approverIds.push(userDoc.id);
    }
  }

  const salesOrderPayload = {
    requestNo,
    projectId,
    projectName: String(projectData.name ?? 'Project'),
    customerId: String(projectData.customerId ?? ''),
    customerName: String(projectData.customerName ?? ''),
    requestedBy: authedUser.id,
    requestedByName: authedUser.fullName,
    estimateNumber,
    estimateAmount: roundAmount(estimateAmount),
    salesOrderNumber,
    salesOrderAmount: roundAmount(salesOrderAmount),
    salesOrderDate,
    status: 'pending_approval',
    approval: {},
    handoffToStore: 'none',
    handedOffAt: '',
    handedOffBy: '',
    handedOffByName: '',
    salesOrderEntryId: '',
    storeReceived: false,
    storeReceivedAt: '',
    storeReceivedBy: '',
    storeReceivedByName: '',
    createdAt: now,
    updatedAt: now,
  };

  const batch = db.batch();
  batch.set(salesOrderRef, salesOrderPayload);

  const activityRef = projectRef.collection('activities').doc();
  batch.set(activityRef, {
    type: 'note',
    note: `Sales Order Req ${requestNo} submitted for approval (Amount ${roundAmount(salesOrderAmount).toLocaleString()}).`,
    date: now,
    createdBy: authedUser.id,
  });

  if (approverIds.length > 0) {
    const eventRef = db.collection('notificationEvents').doc();
    batch.set(eventRef, {
      type: 'sales_order_request.submitted',
      title: 'New Sales Order Req',
      body: `${authedUser.fullName} submitted ${requestNo} for ${String(projectData.name ?? 'a project')}.`,
      entityType: 'salesOrderRequest',
      entityId: salesOrderRef.id,
      actorId: authedUser.id,
      recipients: approverIds,
      broadcast: false,
      createdAt: now,
      meta: {
        requestNo,
        projectId,
        estimateNumber,
        estimateAmount: roundAmount(estimateAmount),
        salesOrderNumber,
        salesOrderAmount: roundAmount(salesOrderAmount),
        salesOrderDate,
      },
    });
  }

  try {
    await batch.commit();
    return NextResponse.json({ id: salesOrderRef.id, ...salesOrderPayload }, { status: 201 });
  } catch {
    return toErrorResponse('Unable to create Sales Order Req.', 500);
  }
}
