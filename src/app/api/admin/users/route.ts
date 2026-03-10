import { NextResponse } from 'next/server';

import type { UserRole } from '@/core/entities/user';
import { getFirebaseAdminAuth, getFirebaseAdminDb } from '@/frameworks/firebase/admin';
import { getAuthedUserFromSession } from '@/lib/auth/serverSession';

export const runtime = 'nodejs';

type CreateUserRequest = {
  uid?: string;
  fullName: string;
  email: string;
  role: UserRole;
  active?: boolean;
  password: string;
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

const resolveRoleKey = async (roleInput: string) => {
  const trimmed = roleInput.trim();
  if (!trimmed) {
    return trimmed;
  }
  if (trimmed.toLowerCase() === 'admin') {
    return 'admin';
  }
  const db = getFirebaseAdminDb();
  const byKey = await db.collection('roles').where('key', '==', trimmed).get();
  if (!byKey.empty) {
    const data = byKey.docs[0]?.data() as { key?: string } | undefined;
    return data?.key ?? trimmed;
  }
  const byName = await db.collection('roles').where('name', '==', trimmed).get();
  if (!byName.empty) {
    const data = byName.docs[0]?.data() as { key?: string } | undefined;
    return data?.key ?? trimmed;
  }
  const docSnap = await db.collection('roles').doc(trimmed).get();
  if (docSnap.exists) {
    const data = docSnap.data() as { key?: string } | undefined;
    if (data?.key) {
      return data.key;
    }
  }
  return trimmed;
};

export async function POST(request: Request) {
  const authError = await requireAdmin(request);
  if (authError) {
    return authError;
  }

  let payload: CreateUserRequest;
  try {
    payload = (await request.json()) as CreateUserRequest;
  } catch {
    return toErrorResponse('Invalid JSON payload.');
  }

  if (!payload.fullName?.trim() || !payload.email?.trim()) {
    return toErrorResponse('Full name and email are required.');
  }

  if (!payload.password || payload.password.length < 6) {
    return toErrorResponse('Password must be at least 6 characters.');
  }

  if (!payload.role || !payload.role.trim()) {
    return toErrorResponse('Role is required.');
  }

  const email = payload.email.trim();
  const fullName = payload.fullName.trim();
  const uid = payload.uid?.trim() || undefined;
  const active = payload.active !== false;
  const roleKey = await resolveRoleKey(payload.role);
  const auth = getFirebaseAdminAuth();
  const db = getFirebaseAdminDb();

  try {
    const authRecord = await auth.createUser({
      uid,
      email,
      password: payload.password,
      displayName: fullName,
      disabled: !active,
    });

    try {
      await db.collection('users').doc(authRecord.uid).set({
        fullName,
        email,
        role: roleKey,
        active,
        createdAt: new Date().toISOString(),
      });
    } catch (err) {
      await auth.deleteUser(authRecord.uid);
      throw err;
    }

    return NextResponse.json({ id: authRecord.uid, resolvedRole: roleKey }, { status: 201 });
  } catch (err) {
    const code = err instanceof Error ? (err as { code?: string }).code : undefined;
    if (code === 'auth/email-already-exists') {
      return toErrorResponse('Email already exists in authentication.');
    }
    if (code === 'auth/uid-already-exists') {
      return toErrorResponse('UID already exists in authentication.');
    }
    if (code === 'auth/invalid-email') {
      return toErrorResponse('Email address is invalid.');
    }
    if (code === 'auth/invalid-password') {
      return toErrorResponse('Password is invalid.');
    }
    return toErrorResponse('Unable to create user.', 500);
  }
}

export async function GET(request: Request) {
  const authError = await requireAdmin(request);
  if (authError) {
    return authError;
  }

  const db = getFirebaseAdminDb();

  try {
    const snapshot = await db.collection('users').get();
    const users = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...(doc.data() as Record<string, unknown>),
    }));
    return NextResponse.json({ users }, { status: 200, headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return toErrorResponse('Unable to load users.', 500);
  }
}

export async function PATCH(request: Request) {
  const authError = await requireAdmin(request);
  if (authError) {
    return authError;
  }

  let payload: Partial<CreateUserRequest> & { id?: string };
  try {
    payload = (await request.json()) as Partial<CreateUserRequest> & {
      id?: string;
    };
  } catch {
    return toErrorResponse('Invalid JSON payload.');
  }

  if (!payload.id) {
    return toErrorResponse('User id is required.');
  }

  const updates: Record<string, unknown> = {};
  if (payload.fullName !== undefined) {
    updates.fullName = payload.fullName.trim();
  }
  if (payload.email !== undefined) {
    updates.email = payload.email.trim();
  }
  if (payload.role !== undefined) {
    updates.role = await resolveRoleKey(payload.role);
  }
  if (payload.active !== undefined) {
    updates.active = payload.active;
  }

  const authUpdates: Record<string, unknown> = {};
  if (payload.fullName !== undefined) {
    authUpdates.displayName = payload.fullName.trim();
  }
  if (payload.email !== undefined) {
    authUpdates.email = payload.email.trim();
  }
  if (payload.active !== undefined) {
    authUpdates.disabled = !payload.active;
  }

  const auth = getFirebaseAdminAuth();
  const db = getFirebaseAdminDb();

  try {
    if (Object.keys(authUpdates).length > 0) {
      await auth.updateUser(payload.id, authUpdates);
    }
    if (Object.keys(updates).length > 0) {
      await db.collection('users').doc(payload.id).update(updates);
    }
    return NextResponse.json({ id: payload.id, resolvedRole: updates.role }, { status: 200 });
  } catch {
    return toErrorResponse('Unable to update user.', 500);
  }
}

export async function DELETE(request: Request) {
  const authError = await requireAdmin(request);
  if (authError) {
    return authError;
  }

  let payload: { id?: string };
  try {
    payload = (await request.json()) as { id?: string };
  } catch {
    return toErrorResponse('Invalid JSON payload.');
  }

  if (!payload.id) {
    return toErrorResponse('User id is required.');
  }

  const auth = getFirebaseAdminAuth();
  const db = getFirebaseAdminDb();

  try {
    await auth.deleteUser(payload.id);
    await db.collection('users').doc(payload.id).delete();
    return NextResponse.json({ id: payload.id }, { status: 200 });
  } catch {
    return toErrorResponse('Unable to delete user.', 500);
  }
}
