'use client';

import React, { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { post, setCurrentWorkspace } from '@/lib/api';
import { Button, Field, Input, Alert } from '@/components/ui';
import { IconBuilds } from '@/components/ui/icons';
import type { User } from '@/lib/types';

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { user } = await post<{ user: User }>('/api/auth/login', { email, password });
      // L'espace est choisi ici plutôt qu'au premier écran : sans cela, la
      // première requête du tableau de bord part sans en-tête X-Workspace.
      if (user.workspaces[0]) setCurrentWorkspace(user.workspaces[0].slug);
      const suite = params.get('suite');
      router.push(user.mustChangePassword ? '/compte?motdepasse=1' : suite || '/tableau-de-bord');
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Connexion impossible');
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="card rise w-full max-w-[380px] p-7">
      <div className="mb-6">
        <span className="mb-4 grid h-10 w-10 place-items-center rounded-xl"
          style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}>
          <IconBuilds size={20} />
        </span>
        <h1 className="text-[19px] font-semibold tracking-[-.01em]">Builder APK</h1>
        <p className="mt-1 text-[13px]" style={{ color: 'var(--ink-3)' }}>
          Compilation et distribution d’applications Android.
        </p>
      </div>

      {error && <div className="mb-4"><Alert tone="danger">{error}</Alert></div>}

      <div className="space-y-3.5">
        <Field label="Adresse électronique" required>
          <Input type="email" value={email} autoComplete="username" required autoFocus
            onChange={(e) => setEmail(e.target.value)} placeholder="prenom.nom@exemple.ci" />
        </Field>
        <Field label="Mot de passe" required>
          <Input type="password" value={password} autoComplete="current-password" required
            onChange={(e) => setPassword(e.target.value)} placeholder="••••••••••" />
        </Field>
      </div>

      <Button type="submit" variant="primary" loading={busy} className="mt-5 w-full">
        Se connecter
      </Button>

      <p className="mt-5 text-center text-[12px] leading-relaxed" style={{ color: 'var(--ink-3)' }}>
        Pas encore de compte ? Il est créé par un propriétaire d’espace depuis
        l’écran Équipe — la plateforme n’a pas d’inscription libre.
      </p>
    </form>
  );
}

export default function LoginPage() {
  return (
    <div className="grid min-h-screen place-items-center p-4">
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
    </div>
  );
}
