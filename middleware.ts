import { NextRequest, NextResponse } from 'next/server';

import { AUTH_SESSION_COOKIE_NAME } from '@/lib/auth/sessionCookie';

export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const hasSession = Boolean(request.cookies.get(AUTH_SESSION_COOKIE_NAME)?.value);

  if (pathname.startsWith('/api/auth/session')) {
    return NextResponse.next();
  }

  if (pathname.startsWith('/api') && !hasSession) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }

  if (pathname.startsWith('/app') && !hasSession) {
    const loginUrl = new URL('/login', request.url);
    const nextPath = `${pathname}${search}`;
    loginUrl.searchParams.set('next', nextPath);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/app/:path*', '/api/:path*'],
};
