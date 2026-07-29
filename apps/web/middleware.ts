import { NextResponse, type NextRequest } from 'next/server';

const COOKIE = process.env.NEXT_PUBLIC_COOKIE_NAME || 'apkb_session';

const PUBLIC = ['/connexion', '/_next', '/api', '/dl', '/latest', '/healthz'];

/**
 * Une ressource, jamais une page.
 *
 * Sans ce test, la garde renvoyait un 307 vers /connexion pour le manifeste,
 * le service worker et les icônes. Un service worker qui reçoit une
 * redirection ne s'enregistre pas : la PWA ne s'installait tout simplement
 * pas, sans le moindre message.
 *
 * Le critère est l'extension dans le dernier segment. Aucune page de cette
 * application n'en porte — les URL sont des mots français sans point.
 */
const estRessource = (chemin: string) => /\.[a-z0-9]+$/i.test(chemin);

/**
 * Origine publique réelle de la requête.
 *
 * Next.js construit `req.nextUrl` à partir de sa propre écoute — 127.0.0.1:3000
 * derrière le frontal — et fabriquait donc des redirections vers localhost.
 * Une cible relative n'est pas une option : le middleware analyse l'en-tête
 * `Location` comme une URL et rejette tout ce qui n'est pas absolu
 * (« TypeError: Invalid URL »).
 *
 * On reconstruit donc l'origine depuis ce que pose le frontal. Apache fournit
 * les deux en-têtes : `X-Forwarded-Host` nativement, `X-Forwarded-Proto` par la
 * directive `RequestHeader` du vhost. Les replis couvrent le développement
 * local, où aucun des deux n'existe.
 */
function origine(req: NextRequest): string {
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host');
  if (!host) return req.nextUrl.origin;
  const proto = req.headers.get('x-forwarded-proto')
    || req.nextUrl.protocol.replace(':', '')
    || 'http';
  return `${proto}://${host}`;
}

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
  if (estRessource(pathname)) return NextResponse.next();
  if (PUBLIC.some((p) => pathname.startsWith(p))) return NextResponse.next();

  if (!req.cookies.get(COOKIE)) {
    const cible = new URL('/connexion', origine(req));
    // La racine est déjà redirigée vers le tableau de bord par next.config :
    // y revenir après connexion n'apprendrait rien de plus.
    if (pathname !== '/') cible.searchParams.set('suite', pathname);
    return NextResponse.redirect(cible, 307);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
