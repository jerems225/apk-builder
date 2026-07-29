'use client';

import React, { Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useResource, useSession } from '@/components/session';
import { PageHeader } from '@/components/shell';
import {
  Card, Badge, Button, Field, Input, Select, Modal, EmptyState, Alert, Skeleton,
} from '@/components/ui';
import {
  IconBuilds, IconPlus, IconRerun, IconTrash, IconStop, IconSearch, IconLink,
} from '@/components/ui/icons';
import { post, del } from '@/lib/api';
import { bytes, duration, relative, STATUS } from '@/lib/format';
import type { Build, Project, BuildStatus, WorkspaceRef } from '@/lib/types';

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
  // Sélection pour le transfert vers un autre espace. Un Set plutôt qu'un
  // tableau : l'appartenance est testée à chaque ligne du tableau.
  const [selection, setSelection] = React.useState<Set<string>>(new Set());
  const [transfert, setTransfert] = React.useState(false);

  const query = new URLSearchParams({ limit: '100' });
  if (status !== 'all') query.set('status', status);
  if (search) query.set('q', search);

  const { data, loading, reload } = useResource<{ total: number; items: Build[] }>(
    `/api/builds?${query.toString()}`, [status, search], 6000,
  );

  // Une sélection qui survit à un changement de filtre porterait sur des
  // lignes devenues invisibles : on la vide.
  React.useEffect(() => { setSelection(new Set()); }, [status, search]);

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

      {selection.size > 0 && can('OWNER') && (
        <Card className="mb-4 flex flex-wrap items-center gap-3 px-4 py-3">
          <span className="text-[13px] font-medium">
            {selection.size} build{selection.size > 1 ? 's' : ''} sélectionné{selection.size > 1 ? 's' : ''}
          </span>
          <div className="flex-1" />
          <Button size="sm" onClick={() => setSelection(new Set())}>Tout désélectionner</Button>
          <Button size="sm" variant="primary" icon={<IconLink size={15} />}
            onClick={() => setTransfert(true)}>
            Transférer vers un autre espace
          </Button>
        </Card>
      )}

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
                  {can('OWNER') && (
                    <th className="w-9 pl-4">
                      <input type="checkbox" aria-label="Tout sélectionner"
                        checked={data.items.length > 0 && selection.size === data.items.length}
                        onChange={(e) => setSelection(e.target.checked
                          ? new Set(data.items.map((b) => b.id)) : new Set())} />
                    </th>
                  )}
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
                    {can('OWNER') && (
                      <td className="pl-4">
                        <input type="checkbox" aria-label={`Sélectionner ${b.repoName}`}
                          checked={selection.has(b.id)}
                          onChange={(e) => setSelection((s) => {
                            const n = new Set(s);
                            if (e.target.checked) n.add(b.id); else n.delete(b.id);
                            return n;
                          })} />
                      </td>
                    )}
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

      <TransfertModal
        open={transfert}
        buildIds={[...selection]}
        onClose={() => setTransfert(false)}
        onFait={(m) => {
          setTransfert(false);
          setSelection(new Set());
          setNotice(m);
          reload(true);
        }}
      />
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


// ──────────────────── Transfert vers un autre espace ─────────────────────────

/**
 * Déplace des builds vers un autre espace de travail.
 *
 * Le service exige le rôle Propriétaire des DEUX côtés : la liste ne propose
 * donc que les espaces où l'on peut réellement déposer. Afficher les autres
 * mènerait à un refus qu'on aurait pu éviter.
 */
function TransfertModal({
  open, buildIds, onClose, onFait,
}: {
  open: boolean;
  buildIds: string[];
  onClose: () => void;
  onFait: (m: string) => void;
}) {
  const { workspace: courant } = useSession();
  const { data: espaces } = useResource<WorkspaceRef[]>(open ? '/api/workspaces' : null, [open]);
  const [cible, setCible] = React.useState('');
  const [projetCible, setProjetCible] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [erreur, setErreur] = React.useState<string | null>(null);

  // Les projets d'accueil se lisent dans l'espace CIBLE. L'en-tête X-Workspace
  // désigne l'espace courant : on le surcharge pour cet appel seulement, sans
  // changer ce qu'affiche le reste de l'interface.
  const { data: projets } = useResource<Project[]>(
    cible ? '/api/projects' : null, [cible], undefined, cible || undefined);

  React.useEffect(() => {
    if (!open) return;
    setCible('');
    setProjetCible('');
    setErreur(null);
  }, [open]);

  const candidats = (espaces ?? []).filter(
    (w) => w.slug !== courant?.slug && w.role === 'OWNER');

  async function soumettre() {
    setBusy(true);
    setErreur(null);
    try {
      const r = await post<{ transferes: number; cible: { name: string } }>(
        '/api/builds/transfer',
        {
          buildIds,
          targetWorkspaceId: cible,
          targetProjectId: projetCible || null,
        });
      onFait(`${r.transferes} build(s) transféré(s) vers « ${r.cible.name} ».`);
    } catch (e) {
      setErreur(e instanceof Error ? e.message : 'Transfert impossible');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} wide
      title={`Transférer ${buildIds.length} build${buildIds.length > 1 ? 's' : ''}`}
      subtitle="Vers un autre espace de travail dont vous êtes propriétaire."
      footer={
        <>
          <Button onClick={onClose}>Annuler</Button>
          <Button variant="primary" loading={busy} disabled={!cible} onClick={soumettre}>
            Transférer
          </Button>
        </>
      }>
      <div className="space-y-3.5">
        {erreur && <Alert tone="danger">{erreur}</Alert>}

        {candidats.length === 0 ? (
          <Alert tone="warn" title="Aucun espace disponible">
            Un transfert demande le rôle Propriétaire dans l’espace de départ <em>et</em> dans
            celui d’arrivée. Sans cela, on pourrait verser les builds d’un client dans un espace
            qu’on contrôle.
          </Alert>
        ) : (
          <>
            <Field label="Espace de destination" required>
              <Select value={cible} onChange={(e) => { setCible(e.target.value); setProjetCible(''); }}>
                <option value="">— choisir —</option>
                {candidats.map((w) => <option key={w.id} value={w.slug}>{w.name}</option>)}
              </Select>
            </Field>

            {cible && (
              <Field label="Rattacher à un projet de cet espace"
                hint="Facultatif. Sans rattachement, l’historique et les liens de téléchargement restent intacts, mais les builds perdent le lien vers des réglages et une clé.">
                <Select value={projetCible} onChange={(e) => setProjetCible(e.target.value)}>
                  <option value="">— aucun projet —</option>
                  {(projets ?? []).map((p) => (
                    <option key={p.id} value={p.id}>{p.name} ({p.repoName})</option>
                  ))}
                </Select>
              </Field>
            )}

            <div className="rounded-lg px-3.5 py-3 text-[12.5px] leading-relaxed"
              style={{ background: 'var(--surface-sunken)', color: 'var(--ink-2)' }}>
              <p className="mb-1 font-semibold" style={{ color: 'var(--ink)' }}>Ce qui se passe</p>
              Les artefacts ne bougent pas du disque — ils sont rangés par identifiant de build,
              pas par espace : <strong>les liens de téléchargement déjà distribués continuent de
              fonctionner</strong>. Un build encore en file ou en cours est refusé, parce que le
              worker le réclame avec le plafond de son espace. L’opération est inscrite au journal
              des deux espaces.
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

export default function BuildsPage() {
  return <Suspense fallback={null}><BuildsScreen /></Suspense>;
}
