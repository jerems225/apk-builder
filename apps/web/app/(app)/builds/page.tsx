'use client';

import React, { Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useResource, useSession } from '@/components/session';
import { PageHeader } from '@/components/shell';
import {
  Card, Badge, Button, Field, Input, Select, Modal, EmptyState, Alert, Skeleton,
} from '@/components/ui';
import { IconBuilds, IconPlus, IconRerun, IconTrash, IconStop, IconSearch } from '@/components/ui/icons';
import { post, del } from '@/lib/api';
import { bytes, duration, relative, STATUS } from '@/lib/format';
import type { Build, Project, BuildStatus } from '@/lib/types';

const FILTERS: { key: BuildStatus | 'all'; label: string }[] = [
  { key: 'all', label: 'Tous' },
  { key: 'running', label: 'En cours' },
  { key: 'queued', label: 'En file' },
  { key: 'success', label: 'Réussis' },
  { key: 'failed', label: 'En échec' },
];

function BuildsScreen() {
  const params = useSearchParams();
  const { can } = useSession();

  const [status, setStatus] = React.useState<BuildStatus | 'all'>('all');
  const [q, setQ] = React.useState(params.get('q') || '');
  const [search, setSearch] = React.useState(params.get('q') || '');
  const [creating, setCreating] = React.useState(params.get('nouveau') === '1');
  const [notice, setNotice] = React.useState<string | null>(null);

  const query = new URLSearchParams({ limit: '100' });
  if (status !== 'all') query.set('status', status);
  if (search) query.set('q', search);

  const { data, loading, reload } = useResource<{ total: number; items: Build[] }>(
    `/api/builds?${query.toString()}`, [status, search], 6000,
  );

  // Recherche différée : relancer la requête à chaque frappe ferait vingt
  // appels pour un mot de dix lettres.
  React.useEffect(() => {
    const t = setTimeout(() => setSearch(q.trim()), 350);
    return () => clearTimeout(t);
  }, [q]);

  async function act(fn: () => Promise<unknown>, message: string) {
    try {
      await fn();
      setNotice(message);
      reload(true);
      setTimeout(() => setNotice(null), 4000);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Action impossible');
    }
  }

  return (
    <>
      <PageHeader
        title="Builds"
        subtitle={data ? `${data.total} build${data.total > 1 ? 's' : ''} dans cet espace` : undefined}
        actions={can('DEVELOPER') && (
          <Button variant="primary" icon={<IconPlus size={16} />} onClick={() => setCreating(true)}>
            Lancer un build
          </Button>
        )}
      />

      {notice && <div className="mb-4"><Alert tone="ok">{notice}</Alert></div>}

      <Card className="mb-4 flex flex-wrap items-center gap-2 p-3">
        <div className="flex flex-wrap gap-1">
          {FILTERS.map((f) => (
            <button key={f.key} onClick={() => setStatus(f.key)}
              className="rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors"
              style={{
                background: status === f.key ? 'var(--accent-wash)' : 'transparent',
                color: status === f.key ? 'var(--accent)' : 'var(--ink-2)',
              }}>
              {f.label}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        <div className="relative w-full sm:w-72">
          <span className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--ink-3)' }}>
            <IconSearch size={15} />
          </span>
          <Input value={q} onChange={(e) => setQ(e.target.value)} className="pl-8"
            placeholder="Filtrer par dépôt ou par référence" />
        </div>
      </Card>

      <Card className="overflow-hidden">
        {loading && !data ? (
          <div className="space-y-2 p-4">
            {[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-12" />)}
          </div>
        ) : !data || data.items.length === 0 ? (
          <EmptyState
            icon={<IconBuilds size={20} />}
            title={search || status !== 'all' ? 'Aucun build ne correspond' : 'Aucun build'}
            description={search || status !== 'all'
              ? 'Élargissez le filtre ou videz la recherche.'
              : 'Poussez sur une branche surveillée, ou lancez un build à la main.'}
            action={can('DEVELOPER') && !search && status === 'all' && (
              <Button variant="primary" onClick={() => setCreating(true)}>Lancer un build</Button>
            )}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr style={{ background: 'var(--surface-sunken)', color: 'var(--ink-3)' }}>
                  <th className="px-4 py-2.5 text-left text-[11.5px] font-semibold uppercase tracking-wide">Projet</th>
                  <th className="px-3 py-2.5 text-left text-[11.5px] font-semibold uppercase tracking-wide">Référence</th>
                  <th className="px-3 py-2.5 text-left text-[11.5px] font-semibold uppercase tracking-wide">État</th>
                  <th className="px-3 py-2.5 text-left text-[11.5px] font-semibold uppercase tracking-wide">Origine</th>
                  <th className="px-3 py-2.5 text-right text-[11.5px] font-semibold uppercase tracking-wide">Taille</th>
                  <th className="px-3 py-2.5 text-right text-[11.5px] font-semibold uppercase tracking-wide">Durée</th>
                  <th className="px-3 py-2.5 text-right text-[11.5px] font-semibold uppercase tracking-wide">Lancé</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {data.items.map((b) => (
                  <tr key={b.id} className="border-t transition-colors hover:bg-[var(--surface-sunken)]"
                    style={{ borderColor: 'var(--line)' }}>
                    <td className="px-4 py-3">
                      <Link href={`/builds/${b.id}`} className="font-medium hover:underline">
                        {b.projectName || b.repoName}
                      </Link>
                      <div className="text-[12px]" style={{ color: 'var(--ink-3)' }}>
                        {b.repoName}{b.appVersion ? ` · v${b.appVersion}` : ''}
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <code className="rounded px-1.5 py-0.5 text-[12px]"
                        style={{ background: 'var(--surface-sunken)', color: 'var(--ink-2)' }}>
                        {b.refType === 'tag' ? '⌗ ' : ''}{b.ref}
                      </code>
                      {b.commitSha && (
                        <span className="ml-1.5 text-[11.5px] tnum" style={{ color: 'var(--ink-3)' }}>
                          {b.commitSha}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <Badge tone={STATUS[b.status].tone} pulse={b.status === 'running'}>
                        {STATUS[b.status].label}
                      </Badge>
                    </td>
                    <td className="px-3 py-3" style={{ color: 'var(--ink-2)' }}>
                      {b.source}
                      {b.triggeredBy && (
                        <div className="text-[11.5px]" style={{ color: 'var(--ink-3)' }}>{b.triggeredBy}</div>
                      )}
                    </td>
                    <td className="px-3 py-3 text-right tnum" style={{ color: 'var(--ink-2)' }}>
                      {bytes(b.apkSize)}
                    </td>
                    <td className="px-3 py-3 text-right tnum" style={{ color: 'var(--ink-2)' }}>
                      {duration(b.durationSec)}
                    </td>
                    <td className="px-3 py-3 text-right whitespace-nowrap" style={{ color: 'var(--ink-3)' }}>
                      {relative(b.createdAt)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        {b.downloadUrl && (
                          <a href={b.downloadUrl} className="rounded-lg px-2 py-1 text-[12.5px] font-semibold"
                            style={{ color: 'var(--accent)' }}>APK</a>
                        )}
                        {can('DEVELOPER') && (b.status === 'running' || b.status === 'queued') && (
                          <IconButton title="Interrompre"
                            onClick={() => act(() => post(`/api/builds/${b.id}/cancel`), 'Interruption demandée.')}>
                            <IconStop size={15} />
                          </IconButton>
                        )}
                        {can('DEVELOPER') && b.status !== 'running' && b.status !== 'queued' && (
                          <IconButton title="Relancer à l’identique"
                            onClick={() => act(() => post(`/api/builds/${b.id}/rerun`), 'Nouveau build en file.')}>
                            <IconRerun size={15} />
                          </IconButton>
                        )}
                        {can('MAINTAINER') && b.status !== 'running' && (
                          <IconButton title="Supprimer le build et son APK" danger
                            onClick={() => {
                              if (confirm(`Supprimer ce build et son APK ?\n\n${b.repoName}@${b.ref}\n\nLes liens de téléchargement déjà distribués cesseront de fonctionner.`)) {
                                act(() => del(`/api/builds/${b.id}`), 'Build supprimé.');
                              }
                            }}>
                            <IconTrash size={15} />
                          </IconButton>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <NewBuildModal open={creating} onClose={() => setCreating(false)}
        onCreated={() => { setCreating(false); reload(true); }} />
    </>
  );
}

function IconButton({
  children, title, onClick, danger,
}: { children: React.ReactNode; title: string; onClick: () => void; danger?: boolean }) {
  return (
    <button onClick={onClick} title={title} aria-label={title}
      className="grid h-7 w-7 place-items-center rounded-lg transition-colors hover:bg-[var(--line)]"
      style={{ color: danger ? 'var(--danger-ink)' : 'var(--ink-2)' }}>
      {children}
    </button>
  );
}

// ─────────────────────────── Lancement manuel ────────────────────────────────

function NewBuildModal({
  open, onClose, onCreated,
}: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const { data: projects } = useResource<Project[]>(open ? '/api/projects' : null, [open]);
  const [projectId, setProjectId] = React.useState('');
  const [ref, setRef] = React.useState('main');
  const [repoUrl, setRepoUrl] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const project = projects?.find((p) => p.id === projectId);

  React.useEffect(() => {
    if (project?.branches[0]) setRef(project.branches[0]);
  }, [project]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await post('/api/builds', projectId ? { projectId, ref } : { repoUrl, ref });
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Lancement impossible');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Lancer un build"
      subtitle="Le build reprend les réglages du projet : sous-dossier, tâche Gradle, architectures et clé de signature."
      footer={
        <>
          <Button onClick={onClose}>Annuler</Button>
          <Button variant="primary" loading={busy} onClick={submit}>Mettre en file</Button>
        </>
      }>
      <form onSubmit={submit} className="space-y-3.5">
        {error && <Alert tone="danger">{error}</Alert>}

        <Field label="Projet"
          hint="Laissez vide pour compiler un dépôt qui n’est pas encore enregistré.">
          <Select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">— dépôt ponctuel —</option>
            {projects?.filter((p) => p.enabled).map((p) => (
              <option key={p.id} value={p.id}>{p.name} ({p.repoName})</option>
            ))}
          </Select>
        </Field>

        {!projectId && (
          <Field label="URL de clone" required
            hint="Adresse HTTPS. Un dépôt privé exige une connexion Git, donc un projet enregistré.">
            <Input value={repoUrl} onChange={(e) => setRepoUrl(e.target.value)} required
              placeholder="https://github.com/organisation/depot.git" />
          </Field>
        )}

        <Field label="Branche ou tag" required>
          <Input value={ref} onChange={(e) => setRef(e.target.value)} required placeholder="main" />
        </Field>

        {project && (
          <div className="rounded-lg px-3.5 py-3 text-[12.5px] leading-relaxed"
            style={{ background: 'var(--surface-sunken)', color: 'var(--ink-2)' }}>
            <p><strong>Tâche</strong> {project.gradleTask} · <strong>Sous-dossier</strong> {project.appSubdir}</p>
            <p className="mt-0.5"><strong>Architectures</strong> {project.abis.join(', ')}</p>
            <p className="mt-0.5">
              <strong>Signature</strong>{' '}
              {project.signing.configured
                ? `clé de release, alias ${project.signing.alias}`
                : 'clé de debug — l’APK ne pourra pas remplacer une version antérieure'}
            </p>
          </div>
        )}
      </form>
    </Modal>
  );
}

export default function BuildsPage() {
  return <Suspense fallback={null}><BuildsScreen /></Suspense>;
}
