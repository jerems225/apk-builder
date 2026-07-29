/** @type {import('next').NextConfig} */

// En production, Apache sert le front sur `/` et l'API sur `/api` et `/dl` :
// même origine, donc le cookie de session part sans réglage particulier et
// CORS ne rentre pas en jeu.
//
// En développement, les deux processus sont sur des ports différents. Ces
// réécritures rejouent la topologie de production côté Next : le navigateur ne
// voit qu'une seule origine, et le code d'appel est identique dans les deux cas.
const API = process.env.API_ORIGIN || 'http://127.0.0.1:9100';

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,

  // La racine n'a pas de contenu propre. La redirection est déclarée ici, au
  // niveau du routage, et non dans une page qui appellerait redirect() : Next
  // la traite avant même d'entrer dans le rendu, donc sans monter de composant
  // ni exécuter de code applicatif pour rien.
  //
  // Elle passe aussi AVANT le middleware. Un visiteur non connecté enchaîne
  // donc / → /tableau-de-bord → /connexion?suite=/tableau-de-bord, et atterrit
  // sur le tableau de bord après connexion — ce qu'on veut.
  //
  // 307 et non 301 : c'est une décision d'organisation des écrans, susceptible
  // de changer. Un 301 serait mis en cache par les navigateurs de l'équipe et
  // survivrait à la modification.
  async redirects() {
    return [
      { source: '/', destination: '/tableau-de-bord', permanent: false },
    ];
  },

  async rewrites() {
    if (process.env.NODE_ENV === 'production' && process.env.PROXY_API !== 'true') return [];
    return [
      { source: '/api/:path*', destination: `${API}/api/:path*` },
      { source: '/dl/:path*', destination: `${API}/dl/:path*` },
      { source: '/latest/:path*', destination: `${API}/latest/:path*` },
      { source: '/healthz', destination: `${API}/healthz` },
    ];
  },
};

export default nextConfig;
