import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const PROTECTED_PREFIXES = ['/profile', '/subscription'];
const AUTH_PAGES = ['/signin', '/signup'];

export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const authed = request.cookies.get('evi_app_auth')?.value === '1';

  const isProtected = PROTECTED_PREFIXES.some((p) => pathname.startsWith(p));
  const isAuthPage = AUTH_PAGES.includes(pathname);

  if (isProtected && !authed) {
    const url = request.nextUrl.clone();
    url.pathname = '/signin';
    if (pathname !== '/') url.search = `?redirect=${encodeURIComponent(pathname + (search || ''))}`;
    return NextResponse.redirect(url);
  }

  if (isAuthPage && authed) {
    const url = request.nextUrl.clone();
    url.pathname = '/chat';
    url.search = '';
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/',
    '/signin',
    '/signup',
    '/chat/:path*',
    '/profile/:path*',
    '/subscription',
  ],
};
