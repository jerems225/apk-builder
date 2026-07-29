import type { MetadataRoute } from 'next';

/**
 * Manifeste PWA.
 *
 * Next sert ce fichier sur /manifest.webmanifest sans déclaration
 * supplémentaire dans le <head>.
 *
 * `display: standalone` plutôt que `fullscreen` : cet outil s'utilise à côté
 * d'un terminal et d'un navigateur, pas en immersion. La barre d'état du
 * système reste utile — on y lit l'heure pendant qu'un build tourne.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Buildex — compilation et distribution d’APK',
    short_name: 'Buildex',
    description:
      'Compilation d’applications React Native et distribution des APK, ' +
      'déclenchées par webhook Git.',
    lang: 'fr',
    dir: 'ltr',
    start_url: '/tableau-de-bord',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    background_color: '#f4f6f9',
    theme_color: '#0E3A45',
    categories: ['developer', 'productivity', 'utilities'],
    icons: [
      // Le SVG sert aux plateformes qui l'acceptent : une seule source, nette
      // à toute taille.
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
      { src: '/marque/icone-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/marque/icone-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      // Les variantes masquables portent un fond plein et 25 % de marge :
      // sans elles, Android rogne la marque en la découpant en cercle.
      { src: '/marque/icone-192-masquable.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: '/marque/icone-512-masquable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      {
        name: 'Builds',
        short_name: 'Builds',
        description: 'Historique et suivi des compilations',
        url: '/builds',
      },
      {
        name: 'Projets',
        short_name: 'Projets',
        description: 'Dépôts suivis et clés de signature',
        url: '/projets',
      },
    ],
  };
}
