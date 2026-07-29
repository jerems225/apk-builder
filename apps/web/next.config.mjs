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
