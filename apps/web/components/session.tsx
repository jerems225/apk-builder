'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { get, post, currentWorkspace, setCurrentWorkspace } from '@/lib/api';
import type { User, WorkspaceRef, Role } from '@/lib/types';

/**
 * Contexte de session. Une seule requête `/api/auth/me` au montage, partagée
 * par tous les écrans : sans cela, chaque page refait l'appel et la barre
 * latérale clignote à chaque navigation.
 */

interface SessionValue {
  user: User | null;
  loading: boolean;
  workspace: WorkspaceRef | null;
  role: Role;
  /** Vrai si le rôle courant est au moins celui demandé. */
  can: (minimum: Role) => boolean;
  switchWorkspace: (slug: string) => void;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const RANK: Role[] = ['VIEWER', 'DEVELOPER', 'MAINTAINER', 'OWNER'];

const Ctx = React.createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [user, setUser] = React.useState<User | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [slug, setSlug] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    try {
      const { user: u } = await get<{ user: User }>('/api/auth/me');
      setUser(u);
      const saved = currentWorkspace();
      const valid = u.workspaces.find((w) => w.slug === saved);
      const chosen = valid ? valid.slug : u.workspaces[0]?.slug ?? null;
      if (chosen && chosen !== saved) setCurrentWorkspace(chosen);
      setSlug(chosen);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => { load(); }, [load]);

  const workspace = React.useMemo(
    () => user?.workspaces.find((w) => w.slug === slug) ?? user?.workspaces[0] ?? null,
    [user, slug],
  );

  // Le super-administrateur agit comme propriétaire partout : c'est le rôle
  // d'exploitation de la plateforme, distinct de l'appartenance à un espace.
  const role: Role = user?.isSuperAdmin ? 'OWNER' : workspace?.role ?? 'VIEWER';

  const value: SessionValue = {
    user,
    loading,
    workspace,
    role,
    can: (minimum) => RANK.indexOf(role) >= RANK.indexOf(minimum),
    switchWorkspace: (s) => {
      setCurrentWorkspace(s);
      setSlug(s);
      // Rechargement complet : chaque écran a déjà chargé les données de
      // l'espace précédent, les rafraîchir un par un laisserait des restes.
      router.refresh();
      window.location.reload();
    },
    refresh: load,
    logout: async () => {
      await post('/api/auth/logout').catch(() => {});
      setCurrentWorkspace(null);
      window.location.href = '/connexion';
    },
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession() {
  const v = React.useContext(Ctx);
  if (!v) throw new Error('useSession doit être utilisé dans <SessionProvider>');
  return v;
}

/**
 * Chargement de données d'écran. Volontairement minimal — pas de cache global,
 * pas de revalidation en arrière-plan : les écrans sont peu nombreux et les
 * données changent à la seconde pendant un build, un cache ferait plus de mal
 * que de bien.
 */
export function useResource<T>(
  path: string | null,
  deps: React.DependencyList = [],
  intervalMs?: number,
) {
  const [data, setData] = React.useState<T | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);

  const reload = React.useCallback(async (silent = false) => {
    if (!path) return;
    if (!silent) setLoading(true);
    try {
      setData(await get<T>(path));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur inattendue');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  React.useEffect(() => { reload(); /* eslint-disable-next-line */ }, [path, ...deps]);

  React.useEffect(() => {
    if (!intervalMs || !path) return;
    // Rafraîchissement silencieux : sans le `silent`, l'écran repasserait en
    // squelette toutes les cinq secondes.
    const t = setInterval(() => reload(true), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs, path, reload]);

  return { data, error, loading, reload, setData };
}
