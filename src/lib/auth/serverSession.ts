import { ALL_PERMISSIONS, PermissionKey } from '@/core/entities/permissions';
import { getFirebaseAdminAuth, getFirebaseAdminDb } from '@/frameworks/firebase/admin';
import { AUTH_SESSION_COOKIE_NAME } from '@/lib/auth/sessionCookie';

export type AuthedUser = {
  id: string;
  fullName: string;
  active: boolean;
  roleKey: string;
  permissions: PermissionKey[];
};

const parseCookieValue = (cookieHeader: string, cookieName: string) => {
  const pairs = cookieHeader.split(';');
  for (const pair of pairs) {
    const separatorIndex = pair.indexOf('=');
    if (separatorIndex <= 0) {
      continue;
    }
    const name = pair.slice(0, separatorIndex).trim();
    if (name !== cookieName) {
      continue;
    }
    return decodeURIComponent(pair.slice(separatorIndex + 1));
  }
  return '';
};

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

export async function getAuthedUserFromSession(request: Request): Promise<AuthedUser | null> {
  const cookieHeader = request.headers.get('cookie') ?? '';
  const sessionCookie = parseCookieValue(cookieHeader, AUTH_SESSION_COOKIE_NAME);
  if (!sessionCookie) {
    return null;
  }

  try {
    const decoded = await getFirebaseAdminAuth().verifySessionCookie(sessionCookie, true);
    const userSnap = await getFirebaseAdminDb().collection('users').doc(decoded.uid).get();
    if (!userSnap.exists) {
      return null;
    }

    const data = userSnap.data() as Record<string, unknown>;
    const roleKey = String(data.role ?? '').trim().toLowerCase();
    const permissions = await resolveRolePermissions(roleKey, new Map<string, PermissionKey[]>());

    return {
      id: decoded.uid,
      fullName: String(data.fullName ?? decoded.name ?? 'User'),
      active: Boolean(data.active ?? true),
      roleKey,
      permissions,
    };
  } catch {
    return null;
  }
}
