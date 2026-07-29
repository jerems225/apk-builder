import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Buildex',
  description: 'Plateforme de compilation et de distribution d’APK React Native',
  robots: { index: false, follow: false },
  // Next sert automatiquement app/icon.svg comme favicon : rien à déclarer ici.
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f4f6f9' },
    { media: '(prefers-color-scheme: dark)', color: '#0a0e17' },
  ],
  // Installée en application, l'interface occupe l'encoche des téléphones
  // récents : sans cela, la barre latérale passe dessous.
  viewportFit: 'cover',
};

/**
 * Le thème est posé sur <html> avant le premier rendu.
 *
 * Sans ce script, la page s'affiche en clair puis bascule en sombre après
 * l'hydratation : un flash blanc à chaque chargement, particulièrement pénible
 * sur un outil qu'on garde ouvert toute la journée.
 */
const THEME_BOOT = `(function(){try{
  var t = localStorage.getItem('apkb.theme');
  if(!t) t = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', t);
}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
