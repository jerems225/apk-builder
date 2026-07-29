/*
 * Service worker de Buildex.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CE QU'IL NE FAIT PAS, ET POURQUOI
 *
 * Il ne met en cache AUCUNE réponse de l'API, ni aucun APK.
 *
 * C'est un outil d'exploitation : l'état d'un build change à la seconde. Servir
 * une réponse mise en cache ferait croire qu'un build tourne encore alors qu'il
 * a échoué, ou l'inverse. Une PWA qui ment sur l'état du système est pire
 * qu'une page qui refuse de s'afficher.
 *
 * Les APK pèsent plus de cent méga-octets : les mettre en cache remplirait le
 * quota du navigateur en trois téléchargements, et ferait évincer le reste.
 *
 * CE QU'IL FAIT
 *
 * Il met en cache la coquille de l'application — code, styles, polices, icônes —
 * pour que l'ouverture soit instantanée et que l'écran hors-ligne s'affiche
 * proprement plutôt qu'un dinosaure.
 * ─────────────────────────────────────────────────────────────────────────────
 */

// Changer cette version force le remplacement du cache au prochain chargement.
// Elle est réécrite à chaque build par next.config.mjs.
const VERSION = 'buildex-v1';
const COQUILLE = `${VERSION}-coquille`;
const HORS_LIGNE = '/hors-ligne.html';

// Jamais interceptés : ces chemins doivent toujours atteindre le réseau.
const RESEAU_SEUL = ['/api/', '/dl/', '/latest/', '/healthz'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(COQUILLE)
      .then((c) => c.addAll([HORS_LIGNE, '/icon.svg']))
      // Un échec de pré-chargement ne doit pas empêcher l'installation :
      // l'application marche sans cache, elle est seulement plus lente.
      .catch(() => {})
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((cles) => Promise.all(
        cles.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k)),
      ))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (RESEAU_SEUL.some((p) => url.pathname.startsWith(p))) return;

  // Ressources versionnées de Next : leur nom contient une empreinte, elles ne
  // changent jamais sous une même URL. Cache d'abord, sans revalidation.
  if (url.pathname.startsWith('/_next/static/')) {
    e.respondWith(
      caches.match(request).then((r) => r || fetch(request).then((rep) => {
        if (rep.ok) caches.open(COQUILLE).then((c) => c.put(request, rep.clone()));
        return rep;
      })),
    );
    return;
  }

  // Navigation : réseau d'abord, cache en secours, page hors-ligne en dernier.
  // L'inverse afficherait une page périmée à quelqu'un qui a du réseau.
  if (request.mode === 'navigate') {
    e.respondWith(
      fetch(request)
        .then((rep) => {
          if (rep.ok) {
            const copie = rep.clone();
            caches.open(COQUILLE).then((c) => c.put(request, copie));
          }
          return rep;
        })
        .catch(() => caches.match(request).then((r) => r || caches.match(HORS_LIGNE))),
    );
    return;
  }

  // Le reste — icônes, manifeste : cache d'abord, réseau en secours.
  e.respondWith(caches.match(request).then((r) => r || fetch(request)));
});
