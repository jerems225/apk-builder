'use client';

import React from 'react';
import Link from 'next/link';
import { useResource, useSession } from '@/components/session';
import { PageHeader } from '@/components/shell';
import {
  Card, CardHeader, Badge, Button, Field, Input, Select, Toggle, Modal,
  EmptyState, Alert, Skeleton, cx,
} from '@/components/ui';
import {
  IconProjects, IconPlus, IconKey, IconTrash, IconSettings, IconDownload, IconCheck,
} from '@/components/ui/icons';
import { post, patch, del, upload } from '@/lib/api';
import { bytes, fingerprint, relative, fullDate, STATUS } from '@/lib/format';
import type {
  Project, Provider, Workspace, KeystoreGenerated, KeystoreExport,
} from '@/lib/types';

/**
 * Déclenche le téléchargement d'un contenu reçu en base64.
 *
 * Le magasin transite en base64 dans la réponse JSON plutôt que par une route
 * de fichier : une clé privée derrière une URL, même authentifiée, finit dans
 * un historique de navigateur ou un journal de frontal. Ici elle ne quitte
 * jamais la mémoire de la page avant d'atterrir sur le disque de l'utilisateur.
 */
function telecharger(nom: string, base64: string, type = 'application/octet-stream') {
  const binaire = atob(base64);
  const octets = new Uint8Array(binaire.length);
  for (let i = 0; i < binaire.length; i++) octets[i] = binaire.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([octets], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = nom;
  a.click();
  URL.revokeObjectURL(url);
}

function telechargerTexte(nom: string, contenu: string) {
  const url = URL.createObjectURL(new Blob([contenu], { type: 'text/plain;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = nom;
  a.click();
  URL.revokeObjectURL(url);
}

const ABIS = [
  { key: 'arm64-v8a', label: 'arm64-v8a', hint: 'L’essentiel du parc en service' },
  { key: 'armeabi-v7a', label: 'armeabi-v7a', hint: 'Téléphones 32 bits, grosso modo d’avant 2015' },
  { key: 'x86_64', label: 'x86_64', hint: 'Émulateurs, équipes QA' },
  { key: 'x86', label: 'x86', hint: 'Anciens émulateurs' },
];

export default function ProjectsPage() {
  const { can } = useSession();
  const { data: projects, loading, reload } = useResource<Project[]>('/api/projects');
  const { data: providers } = useResource<Provider[]>('/api/providers');
  const { data: workspace } = useResource<Workspace>('/api/workspaces/current');

  const [editing, setEditing] = React.useState<Project | 'new' | null>(null);
  const [signing, setSigning] = React.useState<Project | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  const unsigned = projects?.filter((p) => p.enabled && !p.signing.configured).length ?? 0;

  return (
    <>
      <PageHeader
        title="Projets"
        subtitle="Un projet = un dépôt suivi, avec ses branches, sa tâche Gradle et sa clé de signature."
        actions={can('MAINTAINER') && (
          <Button variant="primary" icon={<IconPlus size={16} />} onClick={() => setEditing('new')}>
            Enregistrer un projet
          </Button>
        )}
      />

      {notice && <div className="mb-4"><Alert tone="ok">{notice}</Alert></div>}

      {unsigned > 0 && (
        <div className="mb-4">
          <Alert tone="warn" title={`${unsigned} projet${unsigned > 1 ? 's' : ''} sans clé de release`}>
            Ces APK gardent la clé de debug d’Android : publique, partagée par tout le monde, et
            régénérée si le cache du serveur est vidé. Le jour où cela arrive, plus aucune mise à
            jour ne s’installe par-dessus l’existant — l’utilisateur doit désinstaller, donc perdre
            ses données locales.
          </Alert>
        </div>
      )}

      {loading && !projects ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-44" />)}
        </div>
      ) : !projects || projects.length === 0 ? (
        <Card>
          <EmptyState icon={<IconProjects size={20} />} title="Aucun projet enregistré"
            description="Enregistrez un dépôt pour que ses pushs déclenchent des builds et pour lui attribuer une clé de signature."
            action={can('MAINTAINER') && (
              <Button variant="primary" onClick={() => setEditing('new')}>Enregistrer un projet</Button>
            )} />
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {projects.map((p) => (
            <ProjectCard key={p.id} project={p}
              onEdit={() => setEditing(p)} onSign={() => setSigning(p)}
              onChanged={(m) => { setNotice(m); reload(true); setTimeout(() => setNotice(null), 4000); }} />
          ))}
        </div>
      )}

      <ProjectModal
        open={editing !== null}
        project={editing === 'new' ? null : editing}
        providers={providers || []}
        onClose={() => setEditing(null)}
        onSaved={(m) => { setEditing(null); setNotice(m); reload(true); }}
      />

      <KeystoreModal
        project={signing}
        keytoolDisponible={workspace?.keytoolDisponible ?? true}
        certificat={workspace?.certificat ?? { organisation: '', ville: '', pays: 'CI' }}
        onClose={() => setSigning(null)}
        onSaved={(m) => { setSigning(null); setNotice(m); reload(true); }}
      />
    </>
  );
}

// ──────────────────────────────── Carte projet ───────────────────────────────

function ProjectCard({
  project, onEdit, onSign, onChanged,
}: { project: Project; onEdit: () => void; onSign: () => void; onChanged: (m: string) => void }) {
  const { can } = useSession();
  const p = project;

  return (
    <Card className="flex flex-col">
      <div className="flex items-start justify-between gap-3 p-5 pb-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-[15px] font-semibold">{p.name}</h3>
            {!p.enabled && <Badge tone="idle">Désactivé</Badge>}
          </div>
          <p className="mt-0.5 truncate text-[12.5px]" style={{ color: 'var(--ink-3)' }}>{p.repoName}</p>
        </div>
        {can('MAINTAINER') && (
          <button onClick={onEdit} title="Modifier le projet"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg hover:bg-[var(--surface-sunken)]"
            style={{ color: 'var(--ink-2)' }}>
            <IconSettings size={16} />
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-y-2 px-5 pb-4 text-[12.5px]">
        <Meta label="Branches">{p.branches.join(', ')}</Meta>
        <Meta label="Tâche Gradle"><code>{p.gradleTask}</code></Meta>
        <Meta label="Architectures">{p.abis.join(', ')}</Meta>
        <Meta label="Connexion">{p.provider ? p.provider.label : 'dépôt public'}</Meta>
      </div>

      {/* Bloc signature : mis en évidence parce que c'est la décision la plus
          lourde de conséquences de toute la fiche projet. */}
      <div className={cx('mx-5 mb-4 rounded-lg px-3.5 py-3')}
        style={{ background: p.signing.configured ? 'var(--ok-wash)' : 'var(--warn-wash)' }}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-[13px] font-semibold"
              style={{ color: p.signing.configured ? 'var(--ok-ink)' : 'var(--warn-ink)' }}>
              <IconKey size={15} />
              {p.signing.configured ? 'Clé de release' : 'Clé de debug'}
            </p>
            {p.signing.configured ? (
              <p className="mt-1 truncate text-[11.5px] tnum" style={{ color: 'var(--ok-ink)' }}>
                {p.signing.alias} · {fingerprint(p.signing.fingerprint)}
              </p>
            ) : (
              <p className="mt-1 text-[12px] leading-snug" style={{ color: 'var(--warn-ink)' }}>
                Impubliable, et non installable par-dessus une version antérieure.
              </p>
            )}
          </div>
          {can('MAINTAINER') && (
            <Button size="sm" onClick={onSign}>
              {p.signing.configured ? 'Gérer la clé' : 'Créer une clé'}
            </Button>
          )}
        </div>
        {p.signing.configured && !p.signing.fileOnDisk && (
          <p className="mt-2 text-[12px] font-semibold" style={{ color: 'var(--danger-ink)' }}>
            Le fichier est absent du serveur : les builds repartiront sur la clé de debug.
          </p>
        )}
      </div>

      <div className="flex-1" />

      <div className="flex items-center justify-between gap-3 border-t px-5 py-3"
        style={{ borderColor: 'var(--line)', background: 'var(--surface-sunken)' }}>
        <div className="min-w-0 text-[12.5px]" style={{ color: 'var(--ink-3)' }}>
          {p.lastBuild ? (
            <span className="flex items-center gap-2">
              <Badge tone={STATUS[p.lastBuild.status].tone}>{STATUS[p.lastBuild.status].label}</Badge>
              <span className="truncate">
                {relative(p.lastBuild.createdAt)} · {bytes(p.lastBuild.apkSize)}
              </span>
            </span>
          ) : 'Aucun build'}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Link href={`/builds?q=${encodeURIComponent(p.repoName)}`}
            className="rounded-lg px-2 py-1 text-[12.5px] font-semibold" style={{ color: 'var(--accent)' }}>
            {p.buildCount ?? 0} build{(p.buildCount ?? 0) > 1 ? 's' : ''}
          </Link>
          {can('MAINTAINER') && (
            <button title="Supprimer le projet"
              className="grid h-7 w-7 place-items-center rounded-lg hover:bg-[var(--line)]"
              style={{ color: 'var(--danger-ink)' }}
              onClick={async () => {
                if (!confirm(`Supprimer le projet « ${p.name} » ?\n\nSa clé de signature est effacée du serveur. Les builds déjà produits et leurs liens de téléchargement sont conservés.`)) return;
                await del(`/api/projects/${p.id}`);
                onChanged('Projet supprimé. Les builds déjà produits sont conservés.');
              }}>
              <IconTrash size={15} />
            </button>
          )}
        </div>
      </div>
    </Card>
  );
}

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p style={{ color: 'var(--ink-3)' }}>{label}</p>
      <p className="truncate" style={{ color: 'var(--ink-2)' }}>{children}</p>
    </div>
  );
}

// ──────────────────────── Création / modification ────────────────────────────

function ProjectModal({
  open, project, providers, onClose, onSaved,
}: {
  open: boolean; project: Project | null; providers: Provider[];
  onClose: () => void; onSaved: (m: string) => void;
}) {
  const empty = {
    name: '', repoName: '', repoUrl: '', providerId: '',
    appSubdir: '.', gradleTask: 'assembleDebug', branches: 'main',
    abis: ['arm64-v8a'], buildTags: true, enabled: true,
  };
  const [form, setForm] = React.useState(empty);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});

  React.useEffect(() => {
    if (!open) return;
    setError(null);
    setFieldErrors({});
    setForm(project ? {
      name: project.name, repoName: project.repoName, repoUrl: project.repoUrl,
      providerId: project.providerId || '', appSubdir: project.appSubdir,
      gradleTask: project.gradleTask, branches: project.branches.join(','),
      abis: project.abis, buildTags: project.buildTags, enabled: project.enabled,
    } : empty);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, project]);

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    setFieldErrors({});
    const body = { ...form, providerId: form.providerId || null };
    try {
      if (project) await patch(`/api/projects/${project.id}`, body);
      else await post('/api/projects', body);
      onSaved(project ? 'Projet enregistré.' : 'Projet ajouté.');
    } catch (e) {
      const err = e as { message: string; details?: Record<string, string> };
      setError(err.message);
      if (err.details) setFieldErrors(err.details);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} wide
      title={project ? 'Modifier le projet' : 'Enregistrer un projet'}
      subtitle="Ces réglages sont figés dans chaque build au moment de sa mise en file : un build reste reproductible même si le projet change ensuite."
      footer={
        <>
          <Button onClick={onClose}>Annuler</Button>
          <Button variant="primary" loading={busy} onClick={() => submit()}>
            {project ? 'Enregistrer' : 'Ajouter'}
          </Button>
        </>
      }>
      <form onSubmit={submit} className="space-y-3.5">
        {error && <Alert tone="danger">{error}</Alert>}

        <div className="grid gap-3.5 sm:grid-cols-2">
          <Field label="Nom affiché" required error={fieldErrors.name}
            hint="Libre : c'est ce que lit l'équipe.">
            <Input value={form.name} onChange={(e) => set('name', e.target.value)} required
              placeholder="Application livreur" />
          </Field>
          <Field label="Dépôt" required error={fieldErrors.repoName}
            hint="Exactement comme le nomme le fournisseur Git.">
            <Input value={form.repoName} onChange={(e) => set('repoName', e.target.value)} required
              placeholder="upjunoo/app-livreur" />
          </Field>
        </div>

        <Field label="URL de clone" required error={fieldErrors.repoUrl}>
          <Input value={form.repoUrl} onChange={(e) => set('repoUrl', e.target.value)} required
            placeholder="https://github.com/upjunoo/app-livreur.git" />
        </Field>

        <Field label="Connexion Git"
          hint="Obligatoire pour un dépôt privé. À laisser vide pour un dépôt public.">
          <Select value={form.providerId} onChange={(e) => set('providerId', e.target.value)}>
            <option value="">— dépôt public —</option>
            {providers.map((p) => <option key={p.id} value={p.id}>{p.label} ({p.host})</option>)}
          </Select>
        </Field>

        <div className="grid gap-3.5 sm:grid-cols-2">
          <Field label="Branches surveillées" error={fieldErrors.branches}
            hint="Séparées par des virgules.">
            <Input value={form.branches} onChange={(e) => set('branches', e.target.value)}
              placeholder="main,develop" />
          </Field>
          <Field label="Sous-dossier du projet" error={fieldErrors.appSubdir}
            hint="« . » à la racine, « apps/mobile » dans un monorepo.">
            <Input value={form.appSubdir} onChange={(e) => set('appSubdir', e.target.value)} />
          </Field>
        </div>

        <Field label="Tâche Gradle" error={fieldErrors.gradleTask}
          hint={form.gradleTask.toLowerCase().includes('release') && !project?.signing.configured
            ? 'assembleRelease sans clé de signature produit un APK qu’Android refuse d’installer. Déposez la clé d’abord.'
            : 'assembleDebug pour tester, assembleRelease pour distribuer — ce dernier exige une clé.'}>
          <Select value={form.gradleTask} onChange={(e) => set('gradleTask', e.target.value)}>
            <option value="assembleDebug">assembleDebug</option>
            <option value="assembleRelease">assembleRelease</option>
          </Select>
        </Field>

        <Field label="Architectures natives"
          hint="Une seule architecture divise nettement le poids de l’APK. Réglage ignoré sous React Native 0.71.">
          <div className="grid gap-1.5 sm:grid-cols-2">
            {ABIS.map((a) => {
              const on = form.abis.includes(a.key);
              return (
                <button key={a.key} type="button"
                  onClick={() => set('abis', on
                    ? form.abis.filter((x) => x !== a.key)
                    : [...form.abis, a.key])}
                  className="rounded-lg px-3 py-2 text-left transition-colors"
                  style={{
                    background: on ? 'var(--accent-wash)' : 'var(--surface-sunken)',
                    border: `1px solid ${on ? 'var(--accent)' : 'transparent'}`,
                  }}>
                  <span className="block text-[13px] font-medium"
                    style={{ color: on ? 'var(--accent)' : 'var(--ink)' }}>{a.label}</span>
                  <span className="block text-[11.5px]" style={{ color: 'var(--ink-3)' }}>{a.hint}</span>
                </button>
              );
            })}
          </div>
        </Field>

        <div className="flex flex-wrap gap-5 pt-1">
          <Toggle checked={form.enabled} onChange={(v) => set('enabled', v)}
            label="Projet actif" />
          <Toggle checked={form.buildTags} onChange={(v) => set('buildTags', v)}
            label="Un tag déclenche un build" />
        </div>
      </form>
    </Modal>
  );
}


// ─────────────────────── Clé de signature du projet ──────────────────────────

type Etape = 'accueil' | 'generer' | 'deposer' | 'resultat' | 'exporter';

/**
 * Écran unique pour tout ce qui touche à la clé de release d'un projet :
 * générer, déposer un fichier existant, sauvegarder, retirer.
 *
 * La génération côté serveur est proposée en premier. Demander à chacun
 * d'installer un JDK et de composer une ligne de keytool correcte produit des
 * clés RSA 2048 valides un an, des alias oubliés et des mots de passe choisis à
 * la main. Ici les paramètres sont ceux qu'on veut, à chaque fois.
 *
 * La contrepartie est explicite : une clé générée ici n'existe QUE sur ce
 * serveur tant qu'elle n'a pas été téléchargée. L'écran de résultat refuse de
 * se fermer avant que ce soit fait.
 */
function KeystoreModal({
  project, keytoolDisponible, certificat, onClose, onSaved,
}: {
  project: Project | null;
  keytoolDisponible: boolean;
  certificat: { organisation: string; ville: string; pays: string };
  onClose: () => void;
  onSaved: (m: string) => void;
}) {
  const { can } = useSession();
  const [etape, setEtape] = React.useState<Etape>('accueil');
  const [resultat, setResultat] = React.useState<KeystoreGenerated | null>(null);
  const [erreur, setErreur] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (!project) return;
    setErreur(null);
    setResultat(null);
    setBusy(false);
    // Un projet sans clé n'a rien à consulter : on va droit au formulaire.
    setEtape(project.signing.configured ? 'accueil'
      : keytoolDisponible ? 'generer' : 'deposer');
  }, [project, keytoolDisponible]);

  if (!project) return null;

  const titres: Record<Etape, string> = {
    accueil: 'Clé de signature',
    generer: project.signing.configured ? 'Remplacer par une nouvelle clé' : 'Créer une clé de signature',
    deposer: 'Déposer un magasin existant',
    resultat: 'Clé créée — à sauvegarder maintenant',
    exporter: 'Sauvegarder la clé',
  };

  return (
    <Modal
      open wide
      // L'écran de résultat verrouille la fermeture tant que le magasin n'a pas
      // été téléchargé : c'est le seul moment où il est récupérable sans
      // ré-authentification.
      onClose={etape === 'resultat' ? () => {} : onClose}
      title={titres[etape]}
      subtitle={`Projet « ${project.name} » — ${project.repoName}`}
    >
      {erreur && <div className="mb-3.5"><Alert tone="danger">{erreur}</Alert></div>}

      {etape === 'accueil' && (
        <Accueil
          project={project}
          keytoolDisponible={keytoolDisponible}
          peutExporter={can('OWNER')}
          onGenerer={() => setEtape('generer')}
          onDeposer={() => setEtape('deposer')}
          onExporter={() => setEtape('exporter')}
          onFermer={onClose}
          onRetirer={async () => {
            if (!confirm(
              'Retirer la clé de ce projet ?\n\n' +
              'Les builds suivants repartiront sur la signature de debug, et ne pourront plus ' +
              'remplacer une version déjà installée. Le fichier est effacé du serveur : sans ' +
              'sauvegarde, il est définitivement perdu.')) return;
            setBusy(true);
            try {
              await del(`/api/projects/${project.id}/keystore`);
              onSaved('Clé retirée. Les builds suivants utiliseront la signature de debug.');
            } catch (e) {
              setErreur(e instanceof Error ? e.message : 'Retrait impossible');
              setBusy(false);
            }
          }}
          busy={busy}
        />
      )}

      {etape === 'generer' && (
        <FormulaireGeneration
          project={project}
          certificat={certificat}
          onAnnuler={() => setEtape(project.signing.configured ? 'accueil' : 'accueil')}
          onBasculerDepot={() => setEtape('deposer')}
          onCree={(r) => { setResultat(r); setEtape('resultat'); }}
          onErreur={setErreur}
        />
      )}

      {etape === 'deposer' && (
        <FormulaireDepot
          project={project}
          keytoolDisponible={keytoolDisponible}
          onAnnuler={() => setEtape('accueil')}
          onBasculerGeneration={() => setEtape('generer')}
          onDepose={() => onSaved('Clé enregistrée et vérifiée. Le prochain build sera signé avec elle.')}
          onErreur={setErreur}
        />
      )}

      {etape === 'resultat' && resultat && (
        <Resultat
          project={project}
          resultat={resultat}
          onTermine={() => onSaved('Clé créée. Le prochain build sera signé avec elle.')}
        />
      )}

      {etape === 'exporter' && (
        <FormulaireExport
          project={project}
          onAnnuler={() => setEtape('accueil')}
          onErreur={setErreur}
        />
      )}
    </Modal>
  );
}

// ─────────────────────────────── Accueil ─────────────────────────────────────

function Accueil({
  project, keytoolDisponible, peutExporter, onGenerer, onDeposer, onExporter, onRetirer,
  onFermer, busy,
}: {
  project: Project;
  keytoolDisponible: boolean;
  peutExporter: boolean;
  onGenerer: () => void;
  onDeposer: () => void;
  onExporter: () => void;
  onRetirer: () => void;
  onFermer: () => void;
  busy: boolean;
}) {
  const s = project.signing;
  return (
    <div className="space-y-4">
      <div className="rounded-lg px-4 py-3.5" style={{ background: 'var(--ok-wash)' }}>
        <p className="flex items-center gap-2 text-[13.5px] font-semibold" style={{ color: 'var(--ok-ink)' }}>
          <IconKey size={16} /> Clé de release active
        </p>
        <dl className="mt-2.5 space-y-1.5 text-[12.5px]" style={{ color: 'var(--ok-ink)' }}>
          <Ligne label="Alias">{s.alias}</Ligne>
          <Ligne label="Empreinte SHA-256">
            <code className="break-all tnum">{s.fingerprint}</code>
          </Ligne>
          <Ligne label="Enregistrée le">{fullDate(s.uploadedAt)}</Ligne>
          <Ligne label="Fichier sur le serveur">{s.fileOnDisk ? 'présent' : 'ABSENT'}</Ligne>
        </dl>
      </div>

      {!s.fileOnDisk && (
        <Alert tone="danger" title="Le fichier a disparu du serveur">
          La fiche du projet déclare une clé, mais le magasin n’est plus sur le disque. Les
          prochains builds repartiront sur la signature de debug, et les APK produits ne
          pourront plus remplacer ceux déjà installés. Redéposez votre sauvegarde.
        </Alert>
      )}

      <div className="grid gap-2 sm:grid-cols-2">
        {peutExporter && s.fileOnDisk && (
          <Action
            titre="Sauvegarder la clé"
            texte="Télécharger le magasin et son mot de passe, pour les ranger hors de ce serveur."
            icone={<IconDownload size={17} />}
            onClick={onExporter}
          />
        )}
        {keytoolDisponible && (
          <Action
            titre="Générer une nouvelle clé"
            texte="Remplace celle-ci. Oblige tous les utilisateurs à réinstaller l’application."
            icone={<IconKey size={17} />}
            onClick={onGenerer}
            danger
          />
        )}
        <Action
          titre="Déposer un autre magasin"
          texte="Si vous détenez déjà un fichier .jks pour cette application."
          icone={<IconPlus size={17} />}
          onClick={onDeposer}
          danger
        />
        {peutExporter && (
          <Action
            titre="Retirer la clé"
            texte="Retour à la signature de debug. Le fichier est effacé du serveur."
            icone={<IconTrash size={17} />}
            onClick={onRetirer}
            danger
          />
        )}
      </div>

      <div className="flex justify-end pt-1">
        <Button onClick={onFermer} disabled={busy}>Fermer</Button>
      </div>
    </div>
  );
}

function Ligne({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap gap-x-2">
      <dt className="opacity-75">{label} :</dt>
      <dd className="min-w-0 font-medium">{children}</dd>
    </div>
  );
}

function Action({
  titre, texte, icone, onClick, danger,
}: {
  titre: string; texte: string; icone: React.ReactNode; onClick: () => void; danger?: boolean;
}) {
  return (
    <button type="button" onClick={onClick}
      className="flex gap-3 rounded-lg px-3.5 py-3 text-left transition-colors hover:brightness-[.98]"
      style={{ background: 'var(--surface-sunken)', border: '1px solid var(--line)' }}>
      <span className="mt-0.5 shrink-0" style={{ color: danger ? 'var(--ink-3)' : 'var(--accent)' }}>
        {icone}
      </span>
      <span className="min-w-0">
        <span className="block text-[13.5px] font-semibold">{titre}</span>
        <span className="mt-0.5 block text-[12px] leading-snug" style={{ color: 'var(--ink-3)' }}>
          {texte}
        </span>
      </span>
    </button>
  );
}

// ───────────────────────── Génération côté serveur ───────────────────────────

const PAYS = [
  { code: 'CI', nom: 'Côte d’Ivoire' },
  { code: 'SN', nom: 'Sénégal' },
  { code: 'BF', nom: 'Burkina Faso' },
  { code: 'ML', nom: 'Mali' },
  { code: 'BJ', nom: 'Bénin' },
  { code: 'TG', nom: 'Togo' },
  { code: 'CM', nom: 'Cameroun' },
  { code: 'FR', nom: 'France' },
  { code: 'BE', nom: 'Belgique' },
  { code: 'CA', nom: 'Canada' },
];

function FormulaireGeneration({
  project, certificat, onAnnuler, onBasculerDepot, onCree, onErreur,
}: {
  project: Project;
  certificat: { organisation: string; ville: string; pays: string };
  onAnnuler: () => void;
  onBasculerDepot: () => void;
  onCree: (r: KeystoreGenerated) => void;
  onErreur: (m: string | null) => void;
}) {
  const defautAlias = project.repoName.split('/').pop()!.replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 64);
  const [alias, setAlias] = React.useState(defautAlias);
  const [commonName, setCommonName] = React.useState(project.name);
  // Pré-remplissage venu de l'espace de travail — réglé une fois dans
  // Paramètres, plutôt que ressaisi à chaque projet. Reste modifiable ici pour
  // un client qui publie sous sa propre raison sociale.
  const [organisation, setOrganisation] = React.useState(certificat.organisation);
  const [ville, setVille] = React.useState(certificat.ville);
  const [pays, setPays] = React.useState(certificat.pays || 'CI');
  const [validite, setValidite] = React.useState('10950');
  const [taille, setTaille] = React.useState('4096');
  const [busy, setBusy] = React.useState(false);
  const [compris, setCompris] = React.useState(!project.signing.configured);

  const remplace = project.signing.configured;

  async function soumettre(e?: React.FormEvent) {
    e?.preventDefault();
    onErreur(null);
    setBusy(true);
    try {
      const r = await post<KeystoreGenerated>(`/api/projects/${project.id}/keystore/generate`, {
        alias, commonName, organisation: organisation || undefined,
        ville: ville || undefined, pays: pays || undefined,
        validityDays: Number(validite), keySize: Number(taille),
      });
      onCree(r);
    } catch (err) {
      onErreur(err instanceof Error ? err.message : 'Génération impossible');
      setBusy(false);
    }
  }

  return (
    <form onSubmit={soumettre} className="space-y-3.5">
      <Alert tone={remplace ? 'danger' : 'warn'}
        title={remplace ? 'Remplacer une clé casse les mises à jour' : 'À lire avant de continuer'}>
        {remplace
          ? 'Android refuse catégoriquement une mise à jour signée par une clé différente. Chaque utilisateur devra désinstaller puis réinstaller l’application, et perdra ce qu’elle stocke en local. Faites-le sur une version qui le justifie, pas sur un correctif.'
          : 'Cette clé devient l’identité de publication de l’application, pour toute sa vie. Aucune autorité ne peut la régénérer : sa perte signifie que l’application ne pourra plus jamais être mise à jour. L’écran suivant vous fera la télécharger.'}
      </Alert>

      <div className="grid gap-3.5 sm:grid-cols-2">
        <Field label="Alias de la clé" required
          hint="Identifie la clé dans le magasin. Lettres, chiffres, point, tiret.">
          <Input value={alias} onChange={(e) => setAlias(e.target.value)} required
            pattern="[A-Za-z0-9._\-]{1,64}" />
        </Field>
        <Field label="Nom de l’application (CN)" required
          hint="Visible dans les outils d’inspection d’APK.">
          <Input value={commonName} onChange={(e) => setCommonName(e.target.value)} required />
        </Field>
      </div>

      <div className="grid gap-3.5 sm:grid-cols-3">
        <Field label="Organisation">
          <Input value={organisation} onChange={(e) => setOrganisation(e.target.value)}
            placeholder="Nom de votre organisation" />
        </Field>
        <Field label="Ville">
          <Input value={ville} onChange={(e) => setVille(e.target.value)} />
        </Field>
        <Field label="Pays">
          <Select value={pays} onChange={(e) => setPays(e.target.value)}>
            {PAYS.map((p) => <option key={p.code} value={p.code}>{p.nom}</option>)}
          </Select>
        </Field>
      </div>

      <div className="grid gap-3.5 sm:grid-cols-2">
        <Field label="Validité"
          hint="Une clé qui expire condamne l’application à changer d’identité. Viser large.">
          <Select value={validite} onChange={(e) => setValidite(e.target.value)}>
            <option value="10950">30 ans (recommandé)</option>
            <option value="18250">50 ans</option>
            <option value="3650">10 ans</option>
          </Select>
        </Field>
        <Field label="Taille de la clé"
          hint="4096 bits ajoute quelques secondes à la génération, une fois pour toutes.">
          <Select value={taille} onChange={(e) => setTaille(e.target.value)}>
            <option value="4096">RSA 4096 (recommandé)</option>
            <option value="3072">RSA 3072</option>
            <option value="2048">RSA 2048</option>
          </Select>
        </Field>
      </div>

      <div className="rounded-lg px-3.5 py-3 text-[12px] leading-relaxed"
        style={{ background: 'var(--surface-sunken)', color: 'var(--ink-2)' }}>
        <p className="mb-1 font-semibold" style={{ color: 'var(--ink)' }}>Ce que fait le serveur</p>
        Génère un magasin <strong>PKCS12</strong> — et non JKS, format hérité —, tire le mot de
        passe au sort sur 32 octets, relit le fichier produit pour en extraire l’empreinte réelle,
        puis le range en 0600 dans un répertoire qu’aucune route ne dessert. Le mot de passe est
        chiffré en base et ne vous sera montré qu’une fois, à l’écran suivant.
      </div>

      {remplace && (
        <label className="flex cursor-pointer items-start gap-2.5 rounded-lg px-3.5 py-3 text-[12.5px]"
          style={{ background: 'var(--danger-wash)', color: 'var(--danger-ink)' }}>
          <input type="checkbox" checked={compris} onChange={(e) => setCompris(e.target.checked)}
            className="mt-0.5" />
          <span>
            Je comprends que les utilisateurs ayant déjà installé cette application devront la
            désinstaller puis la réinstaller, en perdant ses données locales.
          </span>
        </label>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
        <button type="button" onClick={onBasculerDepot}
          className="text-[12.5px] font-semibold" style={{ color: 'var(--accent)' }}>
          J’ai déjà un fichier .jks →
        </button>
        <div className="flex gap-2">
          <Button type="button" onClick={onAnnuler}>Annuler</Button>
          <Button type="submit" variant="primary" loading={busy} disabled={!compris}>
            {busy ? 'Génération…' : 'Générer la clé'}
          </Button>
        </div>
      </div>
    </form>
  );
}

// ──────────────────────── Résultat de la génération ──────────────────────────

function Resultat({
  project, resultat, onTermine,
}: { project: Project; resultat: KeystoreGenerated; onTermine: () => void }) {
  const [telecharge, setTelecharge] = React.useState(false);
  const [noteEnregistree, setNoteEnregistree] = React.useState(false);

  const pensebete =
    `Clé de signature Android — ${project.name}\n` +
    `${'='.repeat(60)}\n\n` +
    `Dépôt        : ${project.repoName}\n` +
    `Fichier      : ${resultat.magasin.nom}\n` +
    `Alias        : ${resultat.signing.alias}\n` +
    `Mot de passe : ${resultat.motDePasse}\n` +
    `Empreinte    : ${resultat.signing.fingerprint}\n` +
    `Valide jusqu'au : ${resultat.validUntil ?? 'non relevé'}\n` +
    `Créée le     : ${new Date().toISOString()}\n\n` +
    `En PKCS12, le magasin et la clé partagent le même mot de passe.\n\n` +
    `AVERTISSEMENT\n` +
    `Aucune autorité ne régénère une clé Android. Si ce fichier et ce mot de\n` +
    `passe sont perdus, l'application ne pourra plus jamais être mise à jour :\n` +
    `il faudra en publier une nouvelle, et chaque utilisateur devra désinstaller\n` +
    `l'ancienne. Rangez-les là où vivent les autres secrets de l'équipe.\n`;

  return (
    <div className="space-y-3.5">
      <Alert tone="danger" title="Cette clé n’existe que sur ce serveur">
        {resultat.avertissement}
      </Alert>

      <div className="rounded-lg px-4 py-3.5" style={{ background: 'var(--surface-sunken)' }}>
        <p className="text-[12px]" style={{ color: 'var(--ink-3)' }}>Mot de passe du magasin</p>
        <p className="mt-0.5 select-all break-all text-[15px] font-semibold"
          style={{ fontFamily: 'var(--font-mono)' }}>{resultat.motDePasse}</p>

        <p className="mt-3 text-[12px]" style={{ color: 'var(--ink-3)' }}>Alias</p>
        <p className="text-[13.5px] font-medium">{resultat.signing.alias}</p>

        <p className="mt-3 text-[12px]" style={{ color: 'var(--ink-3)' }}>Empreinte SHA-256</p>
        <code className="block break-all text-[11.5px] tnum" style={{ color: 'var(--ink-2)' }}>
          {resultat.signing.fingerprint}
        </code>

        {resultat.validUntil && (
          <>
            <p className="mt-3 text-[12px]" style={{ color: 'var(--ink-3)' }}>Valide jusqu’au</p>
            <p className="text-[13px]">{resultat.validUntil}</p>
          </>
        )}
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <Button variant="primary" icon={<IconDownload size={16} />}
          onClick={() => {
            telecharger(resultat.magasin.nom, resultat.magasin.contenuBase64);
            setTelecharge(true);
          }}>
          Télécharger le magasin
        </Button>
        <Button icon={<IconDownload size={16} />}
          onClick={() => {
            telechargerTexte(`${resultat.magasin.nom}.infos.txt`, pensebete);
            setNoteEnregistree(true);
          }}>
          Télécharger le pense-bête
        </Button>
      </div>

      <div className="rounded-lg px-3.5 py-3 text-[12.5px] leading-relaxed"
        style={{ background: 'var(--surface-sunken)', color: 'var(--ink-2)' }}>
        <p className="mb-1 font-semibold" style={{ color: 'var(--ink)' }}>Où ranger tout ça</p>
        Là où vivent les autres secrets de l’équipe — gestionnaire de mots de passe, coffre
        chiffré. Pas dans le dépôt Git, pas dans un dossier partagé en clair. Un propriétaire
        pourra re-télécharger le magasin depuis cet écran, mais uniquement en ressaisissant son
        propre mot de passe.
      </div>

      <label className="flex cursor-pointer items-start gap-2.5 text-[12.5px]"
        style={{ color: 'var(--ink-2)' }}>
        <input type="checkbox" checked={noteEnregistree} className="mt-0.5"
          onChange={(e) => setNoteEnregistree(e.target.checked)} />
        <span>J’ai noté le mot de passe hors de ce serveur.</span>
      </label>

      <div className="flex items-center justify-between gap-3 pt-1">
        <span className="text-[12px]" style={{ color: 'var(--ink-3)' }}>
          {telecharge && noteEnregistree
            ? <span style={{ color: 'var(--ok-ink)' }}>
                <IconCheck size={13} /> Sauvegarde confirmée.
              </span>
            : 'Téléchargez le magasin et confirmez la note pour continuer.'}
        </span>
        <Button variant="primary" onClick={onTermine} disabled={!telecharge || !noteEnregistree}>
          Terminer
        </Button>
      </div>
    </div>
  );
}

// ──────────────────────────── Dépôt d'un fichier ─────────────────────────────

function FormulaireDepot({
  project, keytoolDisponible, onAnnuler, onBasculerGeneration, onDepose, onErreur,
}: {
  project: Project;
  keytoolDisponible: boolean;
  onAnnuler: () => void;
  onBasculerGeneration: () => void;
  onDepose: () => void;
  onErreur: (m: string | null) => void;
}) {
  const [fichier, setFichier] = React.useState<File | null>(null);
  const [alias, setAlias] = React.useState('');
  const [motDePasse, setMotDePasse] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  async function soumettre(e?: React.FormEvent) {
    e?.preventDefault();
    onErreur(null);
    if (!fichier) { onErreur('Choisissez le fichier .jks à déposer.'); return; }
    setBusy(true);
    const form = new FormData();
    form.append('keystore', fichier);
    form.append('alias', alias);
    form.append('password', motDePasse);
    try {
      await upload(`/api/projects/${project.id}/keystore`, form);
      onDepose();
    } catch (err) {
      onErreur(err instanceof Error ? err.message : 'Dépôt impossible');
      setBusy(false);
    }
  }

  return (
    <form onSubmit={soumettre} className="space-y-3.5">
      <Alert tone="warn" title="Vérification à la réception">
        Le fichier est ouvert avec keytool avant d’être accepté : un mot de passe faux, un alias
        absent ou un fichier corrompu sont signalés ici, pas au bout d’un build de dix minutes.
      </Alert>

      <Field label="Fichier du magasin (.jks, .p12)" required>
        <input type="file" accept=".jks,.keystore,.p12,.pfx"
          onChange={(e) => setFichier(e.target.files?.[0] ?? null)}
          className="w-full rounded-lg px-3 py-2 text-[13px] file:mr-3 file:rounded-md file:border-0 file:px-3 file:py-1.5 file:text-[12.5px]"
          style={{
            background: 'var(--surface-sunken)', border: '1px solid var(--line-strong)',
            color: 'var(--ink-2)',
          }} />
      </Field>

      <div className="grid gap-3.5 sm:grid-cols-2">
        <Field label="Alias de la clé" required
          hint="Celui indiqué à la génération du magasin.">
          <Input value={alias} onChange={(e) => setAlias(e.target.value)} autoComplete="off" required />
        </Field>
        <Field label="Mot de passe du magasin" required
          hint="En PKCS12, magasin et clé partagent le même mot de passe.">
          <Input type="password" value={motDePasse} onChange={(e) => setMotDePasse(e.target.value)}
            autoComplete="new-password" required />
        </Field>
      </div>

      <p className="text-[12px] leading-relaxed" style={{ color: 'var(--ink-3)' }}>
        Le mot de passe est chiffré en base et n’est jamais réaffiché. Vous reconnaîtrez votre clé
        à son empreinte SHA-256, affichée après le dépôt.
      </p>

      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
        {keytoolDisponible ? (
          <button type="button" onClick={onBasculerGeneration}
            className="text-[12.5px] font-semibold" style={{ color: 'var(--accent)' }}>
            ← Laisser le serveur générer la clé
          </button>
        ) : <span />}
        <div className="flex gap-2">
          <Button type="button" onClick={onAnnuler}>Annuler</Button>
          <Button type="submit" variant="primary" loading={busy}>Vérifier et enregistrer</Button>
        </div>
      </div>
    </form>
  );
}

// ─────────────────────────── Export pour sauvegarde ──────────────────────────

function FormulaireExport({
  project, onAnnuler, onErreur,
}: { project: Project; onAnnuler: () => void; onErreur: (m: string | null) => void }) {
  const [motDePasse, setMotDePasse] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [donnees, setDonnees] = React.useState<KeystoreExport | null>(null);

  async function soumettre(e?: React.FormEvent) {
    e?.preventDefault();
    onErreur(null);
    setBusy(true);
    try {
      setDonnees(await post<KeystoreExport>(`/api/projects/${project.id}/keystore/export`,
        { password: motDePasse }));
      setMotDePasse('');
    } catch (err) {
      onErreur(err instanceof Error ? err.message : 'Export impossible');
    } finally {
      setBusy(false);
    }
  }

  if (donnees) {
    return (
      <div className="space-y-3.5">
        <div className="rounded-lg px-4 py-3.5" style={{ background: 'var(--surface-sunken)' }}>
          <p className="text-[12px]" style={{ color: 'var(--ink-3)' }}>Mot de passe du magasin</p>
          <p className="mt-0.5 select-all break-all text-[15px] font-semibold"
            style={{ fontFamily: 'var(--font-mono)' }}>{donnees.motDePasse}</p>
          <p className="mt-3 text-[12px]" style={{ color: 'var(--ink-3)' }}>Alias</p>
          <p className="text-[13.5px] font-medium">{donnees.alias}</p>
          <p className="mt-3 text-[12px]" style={{ color: 'var(--ink-3)' }}>Empreinte</p>
          <code className="block break-all text-[11.5px] tnum" style={{ color: 'var(--ink-2)' }}>
            {donnees.empreinte}
          </code>
        </div>

        <Button variant="primary" icon={<IconDownload size={16} />} className="w-full"
          onClick={() => telecharger(donnees.nom, donnees.contenuBase64)}>
          Télécharger {donnees.nom}
        </Button>

        <p className="text-[12px] leading-relaxed" style={{ color: 'var(--ink-3)' }}>
          Cet export est inscrit au journal d’activité de l’espace, avec votre nom et l’heure.
          C’est volontaire : la sortie d’une clé privée doit laisser une trace.
        </p>

        <div className="flex justify-end">
          <Button onClick={onAnnuler}>Fermer</Button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={soumettre} className="space-y-3.5">
      <Alert tone="warn" title="Ré-authentification">
        Cette action délivre une clé privée. Ressaisissez <strong>votre</strong> mot de passe de
        compte : c’est ce qui distingue une demande légitime d’une session volée.
      </Alert>

      <Field label="Votre mot de passe" required>
        <Input type="password" value={motDePasse} onChange={(e) => setMotDePasse(e.target.value)}
          autoComplete="current-password" required autoFocus />
      </Field>

      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" onClick={onAnnuler}>Annuler</Button>
        <Button type="submit" variant="primary" loading={busy}>Afficher et télécharger</Button>
      </div>
    </form>
  );
}

