import { NextResponse } from 'next/server';

import { getFirebaseAdminAuth } from '@/frameworks/firebase/admin';
import { AUTH_SESSION_COOKIE_NAME } from '@/lib/auth/sessionCookie';
import { SESSION_DURATION_MS } from '@/lib/auth/sessionPolicy';

type SessionRequest = {
  idToken?: string;
};

const toErrorMessage = (error: unknown) => {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  const code = typeof error === 'object' && error ? (error as { code?: string }).code : undefined;
  if (typeof code === 'string' && code.trim()) {
    return code;
  }

  return 'Invalid authentication token.';
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as SessionRequest;
    const idToken = body.idToken?.trim();

    if (!idToken) {
      return NextResponse.json({ error: 'Missing idToken.' }, { status: 400 });
    }

    await getFirebaseAdminAuth().verifyIdToken(idToken);
    const sessionCookie = await getFirebaseAdminAuth().createSessionCookie(idToken, {
      expiresIn: SESSION_DURATION_MS,
    });

    const response = NextResponse.json({ ok: true });
    response.cookies.set(AUTH_SESSION_COOKIE_NAME, sessionCookie, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: Math.floor(SESSION_DURATION_MS / 1000),
    });

    return response;
  } catch (error) {
    return NextResponse.json({ error: toErrorMessage(error) }, { status: 401 });
  }
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(AUTH_SESSION_COOKIE_NAME, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
  return response;
}
