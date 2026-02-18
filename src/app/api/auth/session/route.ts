import { NextResponse } from 'next/server';

import { getFirebaseAdminAuth } from '@/frameworks/firebase/admin';
import { AUTH_SESSION_COOKIE_NAME } from '@/lib/auth/sessionCookie';

const SESSION_DURATION_MS = 1000 * 60 * 60 * 24 * 5;

type SessionRequest = {
  idToken?: string;
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
  } catch {
    return NextResponse.json({ error: 'Invalid authentication token.' }, { status: 401 });
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
