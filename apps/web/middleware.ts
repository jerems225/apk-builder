import { NextResponse, type NextRequest } from 'next/server';

const COOKIE = process.env.NEXT_PUBLIC_COOKIE_NAME || 'apkb_session';

const PUBLIC = ['/connexion', '/_next', '/favicon', '/api', '/dl', '/latest', '/healthz'];

/**
 * Garde d'accès en bordure. Elle ne vérifie que la PRÉSENCE du cookie, pas sa
 * validité : le cookie est signé et vérifié côté API, et refaire cette
 * vérification ici imposerait un appel réseau à chaque navigation.
 *
 * Son rôle est donc uniquement d'éviter le passage éclair par une page vide
 * avant la redirection. Un cookie périmé est rejeté par l'API, qui renvoie 401
 * et déclenche la redirection côté client.
 */
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC.some((p) => pathname.startsWith(p))) return NextResponse.next();

  if (!req.cookies.get(COOKIE)) {
    const url = req.nextUrl.clone();
    url.pathname = '/connexion';
    if (pathname !== '/') url.searchParams.set('suite', pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
