import { FieldValue } from 'firebase-admin/firestore';

import type { NotificationEntityType, NotificationType } from '@/core/entities/notification';
import { ALL_PERMISSIONS, type PermissionKey } from '@/core/entities/permissions';
import { getFirebaseAdminDb } from '@/frameworks/firebase/admin';

type DispatchNotificationEventInput = {
  type: NotificationType;
  title: string;
  body: string;
  actorId: string;
  recipients?: string[];
  broadcast?: boolean;
  entityType?: NotificationEntityType;
  entityId?: string;
  meta?: Record<string, unknown>;
  requiredPermissionsAnyOf?: PermissionKey[];
};

const normalizePermission = (permission: string): PermissionKey | null => {
  const normalized =
    permission === 'accounts'
      ? 'sales_order'
      : permission === 'po_request_create'
        ? 'sales_order_request_create'
        : permission === 'po_request_view'
          ? 'sales_order_request_view'
          : permission === 'po_request_approve'
            ? 'sales_order_request_approve'
            : permission;
  return ALL_PERMISSIONS.includes(normalized as PermissionKey) ? (normalized as PermissionKey) : null;
};

const resolveRolePermissions = async (
  roleKey: string,
  cache: Map<string, PermissionKey[]>,
): Promise<PermissionKey[]> => {
  const normalizedRole = roleKey.trim().toLowerCase();
  if (!normalizedRole) {
    return [];
  }
  if (normalizedRole === 'admin') {
    return ALL_PERMISSIONS;
  }
  const cached = cache.get(normalizedRole);
  if (cached) {
    return cached;
  }

  const db = getFirebaseAdminDb();
  const byKey = await db.collection('roles').where('key', '==', normalizedRole).limit(1).get();
  if (!byKey.empty) {
    const permissions = ((byKey.docs[0]?.data().permissions ?? []) as string[])
      .map(normalizePermission)
      .filter((permission): permission is PermissionKey => permission !== null);
    cache.set(normalizedRole, permissions);
    return permissions;
  }

  const byId = await db.collection('roles').doc(normalizedRole).get();
  if (byId.exists) {
    const permissions = ((((byId.data()?.permissions as string[]) ?? []) as string[])
      .map(normalizePermission)
      .filter((permission): permission is PermissionKey => permission !== null));
    cache.set(normalizedRole, permissions);
    return permissions;
  }

  cache.set(normalizedRole, []);
  return [];
};

const resolveRecipientIds = async (
  input: DispatchNotificationEventInput,
): Promise<string[]> => {
  const db = getFirebaseAdminDb();
  const usersSnap = await db.collection('users').where('active', '==', true).get();
  const activeUsers = usersSnap.docs.map((docSnap) => ({
    id: docSnap.id,
    roleKey: String(docSnap.data().role ?? '').trim().toLowerCase(),
  }));
  const activeUserIds = new Set(activeUsers.map((user) => user.id));

  let allowedUserIds = activeUserIds;
  const requiredPermissions = Array.from(new Set(input.requiredPermissionsAnyOf ?? []));
  if (requiredPermissions.length > 0) {
    const rolePermissionCache = new Map<string, PermissionKey[]>();
    allowedUserIds = new Set<string>();
    for (const user of activeUsers) {
      const permissions = await resolveRolePermissions(user.roleKey, rolePermissionCache);
      if (requiredPermissions.some((permission) => permissions.includes(permission))) {
        allowedUserIds.add(user.id);
      }
    }
  }

  if (input.broadcast) {
    return Array.from(allowedUserIds);
  }

  const uniqueRecipients = Array.from(new Set((input.recipients ?? []).filter(Boolean)));
  return uniqueRecipients.filter(
    (userId) => activeUserIds.has(userId) && allowedUserIds.has(userId),
  );
};

export const dispatchNotificationEvent = async (input: DispatchNotificationEventInput) => {
  const recipientIds = await resolveRecipientIds(input);
  if (recipientIds.length === 0) {
    return null;
  }

  const payload = {
    type: input.type,
    title: input.title,
    body: input.body,
    entityType: input.entityType ?? null,
    entityId: input.entityId ?? null,
    actorId: input.actorId,
    recipients: recipientIds,
    broadcast: false,
    createdAt: new Date().toISOString(),
    meta: input.meta ?? {},
    dispatchedAt: FieldValue.serverTimestamp(),
    requiredPermissionsAnyOf: input.requiredPermissionsAnyOf ?? [],
  };

  const ref = await getFirebaseAdminDb().collection('notificationEvents').add(payload);
  return { id: ref.id, ...payload, recipients: recipientIds };
};
