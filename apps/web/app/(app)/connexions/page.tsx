'use client';

import React from 'react';
import { useResource, useSession } from '@/components/session';
import { PageHeader } from '@/components/shell';
import {
  Card, Badge, Button, Field, Input, Select, Modal, EmptyState, Alert, Skeleton,
} from '@/components/ui';
import { IconLink, IconPlus, IconTrash, IconGithub, IconSettings } from '@/components/ui/icons';
import { post, patch, del } from '@/lib/api';
import { relative } from '@/lib/format';
import type { Provider } from '@/lib/types';

const KINDS = [
  { key: 'github', label: 'GitHub', host: 'github.com' },
  { key: 'gitlab', label: 'GitLab', host: 'gitlab.com' },
  { key: 'gitea', label: 'Gitea / Forgejo', host: 'git.exemple.ci' },
  { key: 'generic', label: 'Autre', host: '' },
];

export default function ProvidersPage() {
  const { can } = useSession();
  const { data, loading, reload } = useResource<Provider[]>('/api/providers');
  const [editing, setEditing] = React.useState<Provider | 'new' | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  return (
    <>
      <PageHeader
        title="Connexions Git"
        subtitle="Les jetons d’accès aux dépôts privés. Un jeton enregistré ici sert à cloner, jamais à écrire."
        actions={can('MAINTAINER') && (
          <Button variant="primary" icon={<IconPlus size={16} />} onClick={() => setEditing('new')}>
            Ajouter une connexion
          </Button>
        )}
      />

      {notice && <div className="mb-4"><Alert tone="ok">{notice}</Alert></div>}

      <Card className="overflow-hidden">
        {loading && !data ? (
          <div className="space-y-2 p-4">{[0, 1].map((i) => <Skeleton key={i} className="h-16" />)}</div>
        ) : !data || data.length === 0 ? (
          <EmptyState icon={<IconLink size={20} />} title="Aucune connexion"
            description="Sans connexion, seuls les dépôts publics peuvent être compilés. Un jeton en lecture seule suffit."
            action={can('MAINTAINER') && (
              <Button variant="primary" onClick={() => setEditing('new')}>Ajouter une connexion</Button>
            )} />
        ) : (
          <ul>
            {data.map((p) => (
              <li key={p.id} className="flex items-center gap-4 border-b px-5 py-4 last:border-b-0"
                style={{ borderColor: 'var(--line)' }}>
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl"
                  style={{ background: 'var(--surface-sunken)', color: 'var(--ink-2)' }}>
                  {p.kind === 'github' ? <IconGithub size={20} /> : <IconLink size={19} />}
                </span>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-[14px] font-semibold">{p.label}</p>
                    <Badge tone={p.hasToken ? 'ok' : 'warn'}>
                      {p.hasToken ? 'Jeton enregistré' : 'Sans jeton'}
                    </Badge>
                  </div>
                  <p className="mt-0.5 text-[12.5px]" style={{ color: 'var(--ink-3)' }}>
                    {p.host}
                    {p.tokenHint && <> · <code className="tnum">{p.tokenHint}</code></>}
                    {' · '}{p.projectCount ?? 0} projet{(p.projectCount ?? 0) > 1 ? 's' : ''}
                    {' · ajoutée '}{relative(p.createdAt)}
                  </p>
                </div>

                {can('MAINTAINER') && (
                  <div className="flex shrink-0 items-center gap-1">
                    <button onClick={() => setEditing(p)} title="Modifier"
                      className="grid h-8 w-8 place-items-center rounded-lg hover:bg-[var(--surface-sunken)]"
                      style={{ color: 'var(--ink-2)' }}>
                      <IconSettings size={16} />
                    </button>
                    <button title="Supprimer"
                      className="grid h-8 w-8 place-items-center rounded-lg hover:bg-[var(--surface-sunken)]"
                      style={{ color: 'var(--danger-ink)' }}
                      onClick={async () => {
                        const n = p.projectCount ?? 0;
                        if (!confirm(
                          `Supprimer la connexion « ${p.label} » ?` +
                          (n ? `\n\n${n} projet(s) repasseront en accès public : leurs builds échoueront si le dépôt est privé.` : ''),
                        )) return;
                        const r = await del<{ orphanedProjects: number }>(`/api/providers/${p.id}`);
                        setNotice(r.orphanedProjects
                          ? `Connexion supprimée — ${r.orphanedProjects} projet(s) sont repassés en accès public.`
                          : 'Connexion supprimée.');
                        reload(true);
                      }}>
                      <IconTrash size={16} />
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <ProviderModal open={editing !== null} provider={editing === 'new' ? null : editing}
        onClose={() => setEditing(null)}
        onSaved={(m) => { setEditing(null); setNotice(m); reload(true); }} />
    </>
  );
}

function ProviderModal({
  open, provider, onClose, onSaved,
}: { open: boolean; provider: Provider | null; onClose: () => void; onSaved: (m: string) => void }) {
  const [label, setLabel] = React.useState('');
  const [kind, setKind] = React.useState('github');
  const [host, setHost] = React.useState('github.com');
  const [token, setToken] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setError(null);
    setToken('');
    setLabel(provider?.label ?? '');
    setKind(provider?.kind ?? 'github');
    setHost(provider?.host ?? 'github.com');
  }, [open, provider]);

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = { label, kind, host, token: token || undefined };
      if (provider) await patch(`/api/providers/${provider.id}`, body);
      else await post('/api/providers', body);
      onSaved(provider ? 'Connexion enregistrée.' : 'Connexion ajoutée, jeton chiffré en base.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Enregistrement impossible');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose}
      title={provider ? 'Modifier la connexion' : 'Ajouter une connexion Git'}
      footer={
        <>
          <Button onClick={onClose}>Annuler</Button>
          <Button variant="primary" loading={busy} onClick={() => submit()}>
            {provider ? 'Enregistrer' : 'Ajouter'}
          </Button>
        </>
      }>
      <form onSubmit={submit} className="space-y-3.5">
        {error && <Alert tone="danger">{error}</Alert>}

        <Field label="Nom" required hint="Ce que lit l’équipe dans la liste des projets.">
          <Input value={label} onChange={(e) => setLabel(e.target.value)} required
            placeholder="GitHub — organisation Upjunoo" />
        </Field>

        <div className="grid gap-3.5 sm:grid-cols-2">
          <Field label="Fournisseur">
            <Select value={kind} onChange={(e) => {
              setKind(e.target.value);
              const k = KINDS.find((x) => x.key === e.target.value);
              if (k?.host) setHost(k.host);
            }}>
              {KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
            </Select>
          </Field>
          <Field label="Hôte" hint="Nom de domaine, sans https://">
            <Input value={host} onChange={(e) => setHost(e.target.value)} placeholder="github.com" />
          </Field>
        </div>

        <Field label={provider ? 'Nouveau jeton' : 'Jeton d’accès'} required={!provider}
          hint={provider
            ? 'Laissez vide pour conserver le jeton actuel. Il n’est jamais réaffiché.'
            : 'Un jeton en lecture seule sur le contenu des dépôts suffit — n’accordez pas plus.'}>
          <Input type="password" value={token} onChange={(e) => setToken(e.target.value)}
            autoComplete="new-password" placeholder="github_pat_…" />
        </Field>

        <p className="text-[12px] leading-relaxed" style={{ color: 'var(--ink-3)' }}>
          Le jeton est chiffré en AES-256-GCM avant d’être écrit en base, et transmis au conteneur
          de build par un fichier en 0600 — jamais en argument de <code>docker run</code>, dont la
          ligne de commande est lisible par tout compte de la machine.
        </p>
      </form>
    </Modal>
  );
}
