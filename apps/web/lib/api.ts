'use client';

/**
 * Client HTTP unique de l'interface.
 *
 * Deux choix qui expliquent le reste du fichier :
 *
 * — Les URL sont relatives. En production, Apache sert le front et l'API sur la
 *   même origine ; en développement, Next réécrit /api vers le port 9100. Le
 *   code d'appel est donc identique dans les deux cas, et le cookie de session
 *   part sans réglage particulier.
 *
 * — L'espace de travail voyage dans un en-tête (X-Workspace) plutôt que dans
 *   chaque URL. Changer d'espace ne réécrit alors aucune route, et il devient
 *   impossible d'oublier le filtre sur un appel : il est posé ici, une fois.
 */

export class ApiError extends Error {
  status: number;
  details?: Record<string, string>;

  constructor(status: number, message: string, details?: Record<string, string>) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

const WORKSPACE_KEY = 'apkb.workspace';

export const currentWorkspace = () =>
  (typeof window === 'undefined' ? null : window.localStorage.getItem(WORKSPACE_KEY));

export function setCurrentWorkspace(slug: string | null) {
  if (typeof window === 'undefined') return;
  if (slug) window.localStorage.setItem(WORKSPACE_KEY, slug);
  else window.localStorage.removeItem(WORKSPACE_KEY);
}

interface Options extends Omit<RequestInit, 'body'> {
  body?: unknown;
  /** Corps déjà construit (dépôt de fichier) : on ne fixe alors aucun Content-Type. */
  raw?: BodyInit;
}

export async function api<T>(path: string, options: Options = {}): Promise<T> {
  const { body, raw, headers, ...rest } = options;

  const finalHeaders: Record<string, string> = {
    Accept: 'application/json',
    ...(headers as Record<string, string>),
  };
  const ws = currentWorkspace();
  if (ws) finalHeaders['X-Workspace'] = ws;
  // Laisser le navigateur composer lui-même le Content-Type d'un multipart :
  // il doit y inclure la frontière, qu'on ne peut pas deviner ici.
  if (body !== undefined && !raw) finalHeaders['Content-Type'] = 'application/json';

  const res = await fetch(path, {
    credentials: 'same-origin',
    headers: finalHeaders,
    body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined),
    ...rest,
  });

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  let payload: unknown = null;
  if (text) {
    try { payload = JSON.parse(text); } catch { payload = { error: text.slice(0, 400) }; }
  }

  if (!res.ok) {
    const p = (payload || {}) as { error?: string; details?: Record<string, string> };
    // Une session expirée pendant que l'onglet était ouvert doit ramener à la
    // page de connexion, pas afficher une erreur incompréhensible.
    if (res.status === 401 && typeof window !== 'undefined'
      && !window.location.pathname.startsWith('/connexion')) {
      window.location.href = `/connexion?suite=${encodeURIComponent(window.location.pathname)}`;
    }
    throw new ApiError(res.status, p.error || `Erreur ${res.status}`, p.details);
  }
  return payload as T;
}

export const get = <T>(path: string) => api<T>(path);
export const post = <T>(path: string, body?: unknown) => api<T>(path, { method: 'POST', body });
export const patch = <T>(path: string, body?: unknown) => api<T>(path, { method: 'PATCH', body });
export const del = <T>(path: string) => api<T>(path, { method: 'DELETE' });

export const upload = <T>(path: string, form: FormData) =>
  api<T>(path, { method: 'POST', raw: form });
