import { NextResponse } from 'next/server';

import { ALL_PERMISSIONS, PermissionKey } from '@/core/entities/permissions';
import { getFirebaseAdminAuth, getFirebaseAdminDb } from '@/frameworks/firebase/admin';

export const runtime = 'nodejs';

type CreatePoRequestLineItem = {
  description?: string;
  qty?: number;
  unitPrice?: number;
  taxRate?: number;
  notes?: string;
};

type CreatePoRequestPayload = {
  projectId?: string;
  vendorId?: string;
  vendorName?: string;
  currency?: string;
  lineItems?: CreatePoRequestLineItem[];
  notes?: string;
  dueDate?: string;
};

const SALES_NAMESPACE_ID = 'main';
const ACCOUNTS_NAMESPACE_ID = 'main';

const toErrorResponse = (message: string, status = 400) =>
  NextResponse.json({ error: message }, { status });

const toFiniteNumber = (value: unknown) => {
  if (typeof value !== 'number' || Number.isNaN(value) || !Number.isFinite(value)) {
    return null;
  }
  return value;
};

const roundCurrency = (value: number) => Math.round(value * 100) / 100;

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

const getAuthedUser = async (request: Request) => {
  const header = request.headers.get('authorization') ?? request.headers.get('Authorization') ?? '';
  const parts = header.split(' ');
  if (parts.length !== 2 || parts[0]?.toLowerCase() !== 'bearer' || !parts[1]) {
    return null;
  }
  const token = parts[1];
  const decoded = await getFirebaseAdminAuth().verifyIdToken(token);
  const userSnap = await getFirebaseAdminDb().collection('users').doc(decoded.uid).get();
  if (!userSnap.exists) {
    return null;
  }
  const data = userSnap.data() as Record<string, unknown>;
  return {
    id: decoded.uid,
    fullName: String(data.fullName ?? decoded.name ?? 'User'),
    active: Boolean(data.active ?? true),
    roleKey: String(data.role ?? '').trim().toLowerCase(),
  };
};

const buildRequestNo = (id: string, nowIso: string) => {
  const ymd = nowIso.slice(0, 10).replace(/-/g, '');
  return `POR-${ymd}-${id.slice(0, 6).toUpperCase()}`;
};

export async function POST(request: Request) {
  let payload: CreatePoRequestPayload;
  try {
    payload = (await request.json()) as CreatePoRequestPayload;
  } catch {
    return toErrorResponse('Invalid JSON payload.');
  }

  const authedUser = await getAuthedUser(request);
  if (!authedUser) {
    return toErrorResponse('Unauthorized.', 401);
  }
  if (!authedUser.active) {
    return toErrorResponse('Your account is inactive.', 403);
  }

  const permissionCache = new Map<string, PermissionKey[]>();
  const requesterPermissions = await resolveRolePermissions(authedUser.roleKey, permissionCache);
  const canCreate =
    requesterPermissions.includes('admin') || requesterPermissions.includes('po_request_create');
  if (!canCreate) {
    return toErrorResponse('You do not have permission to create PO requests.', 403);
  }

  const projectId = payload.projectId?.trim();
  const vendorName = payload.vendorName?.trim();
  if (!projectId) {
    return toErrorResponse('Project id is required.');
  }
  if (!vendorName) {
    return toErrorResponse('Vendor name is required.');
  }

  const rawLineItems = Array.isArray(payload.lineItems) ? payload.lineItems : [];
  if (rawLineItems.length === 0) {
    return toErrorResponse('At least one line item is required.');
  }

  let lineItems: Array<{
    description: string;
    qty: number;
    unitPrice: number;
    taxRate: number;
    taxAmount: number;
    lineTotal: number;
    notes: string;
  }>;
  try {
    lineItems = rawLineItems.map((item) => {
      const description = String(item.description ?? '').trim();
      const qty = toFiniteNumber(item.qty);
      const unitPrice = toFiniteNumber(item.unitPrice);
      const taxRateRaw = toFiniteNumber(item.taxRate);
      const taxRate = taxRateRaw === null ? 0 : taxRateRaw;
      if (!description) {
        throw new Error('Each line item requires a description.');
      }
      if (qty === null || qty <= 0) {
        throw new Error('Each line item requires qty greater than 0.');
      }
      if (unitPrice === null || unitPrice < 0) {
        throw new Error('Each line item requires unit price of 0 or more.');
      }
      if (taxRate < 0) {
        throw new Error('Tax rate cannot be negative.');
      }
      const base = qty * unitPrice;
      const taxAmount = base * (taxRate / 100);
      const lineTotal = base + taxAmount;
      return {
        description,
        qty,
        unitPrice: roundCurrency(unitPrice),
        taxRate: roundCurrency(taxRate),
        taxAmount: roundCurrency(taxAmount),
        lineTotal: roundCurrency(lineTotal),
        notes: String(item.notes ?? '').trim(),
      };
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Invalid line item payload.';
    return toErrorResponse(message, 400);
  }

  const subtotal = roundCurrency(lineItems.reduce((sum, item) => sum + item.qty * item.unitPrice, 0));
  const taxAmount = roundCurrency(lineItems.reduce((sum, item) => sum + item.taxAmount, 0));
  const total = roundCurrency(subtotal + taxAmount);

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
    return toErrorResponse('You can only request PO for your assigned projects.', 403);
  }

  const now = new Date().toISOString();
  const poRef = db
    .collection('accounts')
    .doc(ACCOUNTS_NAMESPACE_ID)
    .collection('po_requests')
    .doc();
  const requestNo = buildRequestNo(poRef.id, now);
  const currency = payload.currency?.trim().toUpperCase() || 'AED';

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
    if (perms.includes('admin') || perms.includes('po_request_approve')) {
      approverIds.push(userDoc.id);
    }
  }

  const poPayload = {
    requestNo,
    projectId,
    projectName: String(projectData.name ?? 'Project'),
    customerId: String(projectData.customerId ?? ''),
    customerName: String(projectData.customerName ?? ''),
    requestedBy: authedUser.id,
    requestedByName: authedUser.fullName,
    vendorId: payload.vendorId?.trim() || '',
    vendorName,
    currency,
    lineItems,
    subtotal,
    taxAmount,
    total,
    notes: payload.notes?.trim() ?? '',
    dueDate: payload.dueDate?.trim() ?? '',
    status: 'pending_approval',
    approval: {},
    accountsEntryId: '',
    createdAt: now,
    updatedAt: now,
  };

  const batch = db.batch();
  batch.set(poRef, poPayload);

  const activityRef = projectRef.collection('activities').doc();
  batch.set(activityRef, {
    type: 'note',
    note: `PO request ${requestNo} submitted for approval (${currency} ${total.toLocaleString()}).`,
    date: now,
    createdBy: authedUser.id,
  });

  if (approverIds.length > 0) {
    const eventRef = db.collection('notificationEvents').doc();
    batch.set(eventRef, {
      type: 'po_request.submitted',
      title: 'New PO Request',
      body: `${authedUser.fullName} submitted ${requestNo} for ${String(projectData.name ?? 'a project')}.`,
      entityType: 'purchaseOrderRequest',
      entityId: poRef.id,
      actorId: authedUser.id,
      recipients: approverIds,
      broadcast: false,
      createdAt: now,
      meta: {
        requestNo,
        projectId,
        total,
        currency,
      },
    });
  }

  try {
    await batch.commit();
    return NextResponse.json({ id: poRef.id, ...poPayload }, { status: 201 });
  } catch {
    return toErrorResponse('Unable to create PO request.', 500);
  }
}
