'use client';

import React, { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { useResource, useSession } from '@/components/session';
import { PageHeader } from '@/components/shell';
import { Card, CardHeader, Badge, Button, Field, Input, Alert, Skeleton } from '@/components/ui';
import { post, del } from '@/lib/api';
import { initials, relative, fullDate } from '@/lib/format';

interface SessionRow {
  id: string; userAgent: string | null; ip: string | null;
  createdAt: string; expiresAt: string; current: boolean;
}

function AccountScreen() {
  const params = useSearchParams();
  const { user, refresh } = useSession();
  const forced = params.get('motdepasse') === '1' || user?.mustChangePassword;

  const [current, setCurrent] = React.useState('');
  const [next, setNext] = React.useState('');
  const [confirm, setConfirm] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState(false);

  const { data: sessions, reload } = useResource<SessionRow[]>('/api/auth/sessions');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (next !== confirm) { setError('Les deux saisies du nouveau mot de passe diffèrent.'); return; }
    setBusy(true);
    setError(null);
    try {
      await post('/api/auth/password', { currentPassword: current, newPassword: next });
      setDone(true);
      setCurrent(''); setNext(''); setConfirm('');
      await refresh();
      reload(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Changement impossible');
    } finally {
      setBusy(false);
    }
  }

  if (!user) return <Skeleton className="h-64" />;

  return (
    <>
      <PageHeader title="Mon compte" subtitle={user.email} />

      {forced && !done && (
        <div className="mb-4">
          <Alert tone="warn" title="Mot de passe à changer">
            Ce compte utilise encore le mot de passe provisoire transmis par un administrateur.
            Choisissez-en un autre pour accéder au reste de la plateforme.
          </Alert>
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title="Identité" />
          <div className="flex items-center gap-4 border-t px-5 py-4" style={{ borderColor: 'var(--line)' }}>
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full text-[15px] font-bold text-white"
              style={{ background: user.avatarColor }}>
              {initials(user.name)}
            </span>
            <div className="min-w-0">
              <p className="text-[15px] font-semibold">{user.name}</p>
              <p className="truncate text-[13px]" style={{ color: 'var(--ink-3)' }}>{user.email}</p>
            </div>
          </div>
          <div className="border-t px-5 py-4" style={{ borderColor: 'var(--line)' }}>
            <p className="mb-2 text-[12.5px] font-semibold" style={{ color: 'var(--ink-2)' }}>
              Espaces accessibles
            </p>
            <ul className="space-y-1.5">
              {user.workspaces.map((w) => (
                <li key={w.id} className="flex items-center justify-between gap-3 text-[13px]">
                  <span className="truncate">{w.name}</span>
                  <Badge tone="idle">{w.roleLabel ?? w.role}</Badge>
                </li>
              ))}
            </ul>
            {user.isSuperAdmin && (
              <p className="mt-3 text-[12px]" style={{ color: 'var(--ink-3)' }}>
                Ce compte est super-administrateur : il agit comme propriétaire dans tous les espaces.
              </p>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="Mot de passe"
            subtitle="Le changer ferme toutes vos autres sessions — c’est le seul moyen de reprendre la main si le compte a été utilisé ailleurs." />
          <form onSubmit={submit} className="space-y-3.5 border-t px-5 py-4"
            style={{ borderColor: 'var(--line)' }}>
            {done && <Alert tone="ok">Mot de passe changé. Les autres sessions ont été fermées.</Alert>}
            {error && <Alert tone="danger">{error}</Alert>}

            <Field label="Mot de passe actuel" required>
              <Input type="password" value={current} onChange={(e) => setCurrent(e.target.value)}
                required autoComplete="current-password" />
            </Field>
            <Field label="Nouveau mot de passe" required
              hint="Au moins 10 caractères, avec une lettre et un chiffre.">
              <Input type="password" value={next} onChange={(e) => setNext(e.target.value)}
                required autoComplete="new-password" />
            </Field>
            <Field label="Confirmation" required>
              <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)}
                required autoComplete="new-password" />
            </Field>
            <Button type="submit" variant="primary" loading={busy}>Changer le mot de passe</Button>
          </form>
        </Card>

        <Card className="xl:col-span-2">
          <CardHeader title="Sessions ouvertes"
            subtitle="Chaque navigateur connecté avec ce compte. Fermez celles que vous ne reconnaissez pas." />
          <div className="border-t" style={{ borderColor: 'var(--line)' }}>
            {!sessions ? <Skeleton className="m-4 h-14" /> : (
              <ul>
                {sessions.map((s) => (
                  <li key={s.id} className="flex items-center gap-3 border-b px-5 py-3 last:border-b-0"
                    style={{ borderColor: 'var(--line)' }}>
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-2 text-[13px]">
                        <span className="truncate">{shortAgent(s.userAgent)}</span>
                        {s.current && <Badge tone="run">session actuelle</Badge>}
                      </p>
                      <p className="text-[12px]" style={{ color: 'var(--ink-3)' }}>
                        {s.ip || 'adresse inconnue'} · ouverte {relative(s.createdAt)} ·
                        expire le {fullDate(s.expiresAt)}
                      </p>
                    </div>
                    {!s.current && (
                      <Button size="sm" onClick={async () => {
                        await del(`/api/auth/sessions/${s.id}`);
                        reload(true);
                      }}>Fermer</Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>
      </div>
    </>
  );
}

/** Résumé lisible d'un User-Agent. La chaîne brute est illisible et inutile ici. */
function shortAgent(ua: string | null): string {
  if (!ua) return 'Client inconnu';
  const os = /Windows/i.test(ua) ? 'Windows'
    : /Android/i.test(ua) ? 'Android'
      : /iPhone|iPad/i.test(ua) ? 'iOS'
        : /Mac OS/i.test(ua) ? 'macOS'
          : /Linux/i.test(ua) ? 'Linux' : 'Système inconnu';
  const nav = /Edg\//i.test(ua) ? 'Edge'
    : /Chrome\//i.test(ua) ? 'Chrome'
      : /Firefox\//i.test(ua) ? 'Firefox'
        : /Safari\//i.test(ua) ? 'Safari' : 'Navigateur inconnu';
  return `${nav} sur ${os}`;
}

export default function AccountPage() {
  return <Suspense fallback={null}><AccountScreen /></Suspense>;
}
