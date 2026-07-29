import { NextResponse, type NextRequest } from 'next/server';

const COOKIE = process.env.NEXT_PUBLIC_COOKIE_NAME || 'apkb_session';

const PUBLIC = ['/connexion', '/_next', '/favicon', '/api', '/dl', '/latest', '/healthz'];

/**
 * Garde d'accès en bordure. Elle ne vérifie que la PRÉSENCE du cookie, pas sa
 * validité : le cookie est vérifié côté API, et refaire cette vérification ici
 * imposerait un appel réseau à chaque navigation.
 *
 * Son rôle est donc uniquement d'éviter le passage éclair par une page vide
 * avant la redirection. Un cookie périmé est rejeté par l'API, qui renvoie 401
 * et déclenche la redirection côté client.
 */
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC.some((p) => pathname.startsWith(p))) return NextResponse.next();

  if (!req.cookies.get(COOKIE)) {
    // Redirection RELATIVE, et non NextResponse.redirect().
    //
    // Cette dernière exige une URL absolue, que Next construit à partir de sa
    // propre écoute — 127.0.0.1:3000 derrière le frontal. En production, le
    // navigateur se retrouvait donc envoyé sur http://localhost:3000/connexion,
    // c'est-à-dire nulle part.
    //
    // Reconstruire l'origine depuis X-Forwarded-Host et X-Forwarded-Proto
    // marcherait, mais mod_proxy ne pose pas systématiquement le second : le
    // schéma serait deviné. Une cible relative est résolue par le navigateur
    // contre l'URL courante, donc toujours juste, en développement comme
    // derrière Apache, en HTTP comme en HTTPS.
    const suite = pathname === '/' ? '' : `?suite=${encodeURIComponent(pathname)}`;
    return new NextResponse(null, {
      status: 307,
      headers: { Location: `/connexion${suite}` },
    });
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
