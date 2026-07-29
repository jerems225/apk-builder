'use client';

import React from 'react';
import Link from 'next/link';
import { useResource, useSession } from '@/components/session';
import { PageHeader } from '@/components/shell';
import {
  Card, CardHeader, Badge, Button, Field, Input, Select, Toggle, Modal,
  EmptyState, Alert, Skeleton, cx,
} from '@/components/ui';
import { IconProjects, IconPlus, IconKey, IconTrash, IconSettings } from '@/components/ui/icons';
import { post, patch, del, upload } from '@/lib/api';
import { bytes, fingerprint, relative, STATUS } from '@/lib/format';
import type { Project, Provider } from '@/lib/types';

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
              {p.signing.configured ? 'Remplacer' : 'Déposer'}
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

// ──────────────────────────── Dépôt de la clé ────────────────────────────────

function KeystoreModal({
  project, onClose, onSaved,
}: { project: Project | null; onClose: () => void; onSaved: (m: string) => void }) {
  const { can } = useSession();
  const [file, setFile] = React.useState<File | null>(null);
  const [alias, setAlias] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setFile(null); setAlias(''); setPassword(''); setError(null);
  }, [project]);

  if (!project) return null;
  const replacing = project.signing.configured;

  async function submit() {
    if (!file) { setError('Choisissez le fichier .jks à déposer.'); return; }
    setBusy(true);
    setError(null);
    const form = new FormData();
    form.append('keystore', file);
    form.append('alias', alias);
    form.append('password', password);
    try {
      await upload(`/api/projects/${project!.id}/keystore`, form);
      onSaved('Clé enregistrée et vérifiée. Le prochain build sera signé avec elle.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Dépôt impossible');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} wide
      title={replacing ? 'Remplacer la clé de signature' : 'Déposer une clé de signature'}
      subtitle={`Projet « ${project.name} »`}
      footer={
        <>
          <Button onClick={onClose}>Annuler</Button>
          {replacing && can('OWNER') && (
            <Button variant="danger"
              onClick={async () => {
                if (!confirm('Retirer la clé ? Les builds suivants repartiront sur la signature de debug.')) return;
                await del(`/api/projects/${project.id}/keystore`);
                onSaved('Clé retirée. Les builds suivants utiliseront la signature de debug.');
              }}>Retirer la clé</Button>
          )}
          <Button variant="primary" loading={busy} onClick={submit}>Vérifier et enregistrer</Button>
        </>
      }>
      <div className="space-y-3.5">
        <Alert tone={replacing ? 'danger' : 'warn'}
          title={replacing ? 'Changer de clé casse les mises à jour' : 'À lire avant de continuer'}>
          {replacing
            ? 'Android refuse catégoriquement une mise à jour signée par une clé différente. Chaque utilisateur devra désinstaller puis réinstaller l’application, et perdra ce qu’elle stocke en local. Planifiez ce basculement sur une version qui le justifie, pas sur un correctif.'
            : 'Cette clé devient l’identité de publication de l’application. Sa perte est irréversible : aucune autorité ne peut la régénérer, et l’application ne pourra plus jamais être mise à jour. Sauvegardez le fichier .jks et son mot de passe hors de ce serveur.'}
        </Alert>

        {error && <Alert tone="danger">{error}</Alert>}

        <Field label="Fichier du magasin (.jks, format PKCS12)" required>
          <input type="file" accept=".jks,.keystore,.p12,.pfx"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="w-full rounded-lg px-3 py-2 text-[13px] file:mr-3 file:rounded-md file:border-0 file:px-3 file:py-1.5 file:text-[12.5px]"
            style={{
              background: 'var(--surface-sunken)', border: '1px solid var(--line-strong)',
              color: 'var(--ink-2)',
            }} />
        </Field>

        <div className="grid gap-3.5 sm:grid-cols-2">
          <Field label="Alias de la clé" required
            hint="Celui indiqué à la génération avec keytool.">
            <Input value={alias} onChange={(e) => setAlias(e.target.value)}
              placeholder="upjunoo-livreur" autoComplete="off" />
          </Field>
          <Field label="Mot de passe du magasin" required
            hint="En PKCS12, magasin et clé partagent le même mot de passe.">
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password" />
          </Field>
        </div>

        <details className="rounded-lg px-3.5 py-3 text-[12.5px] leading-relaxed"
          style={{ background: 'var(--surface-sunken)', color: 'var(--ink-2)' }}>
          <summary className="cursor-pointer font-semibold" style={{ color: 'var(--ink)' }}>
            Générer une clé, si vous n’en avez pas encore
          </summary>
          <pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-[11.5px]"
            style={{ fontFamily: 'var(--font-mono)' }}>{`keytool -genkeypair -v \\
  -keystore ${project.repoName.split('/').pop()}.jks \\
  -storetype PKCS12 \\
  -alias ${project.repoName.split('/').pop()} \\
  -keyalg RSA -keysize 4096 \\
  -validity 10950 \\
  -dname "CN=${project.name}, O=Votre organisation, L=Abidjan, C=CI"`}</pre>
          <ul className="mt-2 list-disc space-y-1 pl-4">
            <li><strong>PKCS12 et non JKS</strong> : JKS est un format hérité, keytool avertit à chaque usage.</li>
            <li><strong>10950 jours ≈ 30 ans</strong> : une clé expirée condamne l’application à changer d’identité.</li>
            <li>Tirez le mot de passe au sort : <code>openssl rand -base64 32</code>.</li>
          </ul>
        </details>

        <p className="text-[12px] leading-relaxed" style={{ color: 'var(--ink-3)' }}>
          Le fichier est vérifié avec keytool avant d’être accepté : un mot de passe faux ou un
          alias absent est signalé maintenant, pas au bout d’un build de dix minutes. Le mot de
          passe est chiffré en base et n’est jamais réaffiché — vous reconnaîtrez votre clé à son
          empreinte.
        </p>
      </div>
    </Modal>
  );
}
