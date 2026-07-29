'use client';

import React from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useResource, useSession } from '@/components/session';
import { PageHeader } from '@/components/shell';
import { Card, CardHeader, Badge, Button, Alert, Skeleton } from '@/components/ui';
import { IconDownload, IconRerun, IconStop, IconChevron, IconAlert } from '@/components/ui/icons';
import { post } from '@/lib/api';
import { bytes, duration, fullDate, fingerprint, STATUS } from '@/lib/format';
import type { Build } from '@/lib/types';

export default function BuildDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useSession();
  const [notice, setNotice] = React.useState<string | null>(null);

  const { data: build, error, reload } = useResource<Build>(`/api/builds/${id}`, [id], 5000);
  // Le journal est rechargé plus souvent tant que le build tourne, et plus du
  // tout ensuite : inutile de solliciter le disque pour un fichier figé.
  const live = build?.status === 'running' || build?.status === 'queued';
  const { data: logData } = useResource<{ log: string; status: string }>(
    `/api/builds/${id}/log`, [id, live], live ? 3000 : undefined,
  );

  const logRef = React.useRef<HTMLPreElement>(null);
  const [follow, setFollow] = React.useState(true);

  React.useEffect(() => {
    if (follow && logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logData?.log, follow]);

  if (error) return <Alert tone="danger" title="Build introuvable">{error}</Alert>;
  if (!build) return <Skeleton className="h-64" />;

  const st = STATUS[build.status];

  return (
    <>
      <nav className="mb-3 flex items-center gap-1.5 text-[12.5px]" style={{ color: 'var(--ink-3)' }}>
        <Link href="/builds" className="hover:underline">Builds</Link>
        <IconChevron size={13} />
        <span className="tnum">{build.id.slice(0, 8)}</span>
      </nav>

      <PageHeader
        title={build.projectName || build.repoName}
        subtitle={<>
          {build.repoName} · <code>{build.ref}</code>
          {build.commitSha && <> · commit <code className="tnum">{build.commitSha}</code></>}
        </>}
        actions={
          <>
            {build.downloadUrl && (
              <a href={build.downloadUrl}>
                <Button variant="primary" icon={<IconDownload size={16} />}>Télécharger l’APK</Button>
              </a>
            )}
            {can('DEVELOPER') && (build.status === 'running' || build.status === 'queued') && (
              <Button icon={<IconStop size={16} />}
                onClick={async () => {
                  await post(`/api/builds/${build.id}/cancel`).catch(() => {});
                  setNotice('Interruption demandée.');
                  reload(true);
                }}>Interrompre</Button>
            )}
            {can('DEVELOPER') && !live && (
              <Button icon={<IconRerun size={16} />}
                onClick={async () => {
                  const nb = await post<Build>(`/api/builds/${build.id}/rerun`);
                  window.location.href = `/builds/${nb.id}`;
                }}>Relancer</Button>
            )}
          </>
        }
      />

      {notice && <div className="mb-4"><Alert tone="ok">{notice}</Alert></div>}

      {build.error && (
        <div className="mb-4">
          <Alert tone="danger" title="Ce build a échoué">{build.error}</Alert>
        </div>
      )}

      {/* Contrôle de signature : c'est le seul endroit où une régression de clé
          se voit avant qu'un utilisateur ne signale une installation refusée. */}
      {build.signedWith && build.signatureMatchesProject === false && (
        <div className="mb-4">
          <Alert tone="danger" title="L’empreinte apposée diffère de celle du projet">
            L’APK a été signé avec <code>{fingerprint(build.signedWith)}</code>, alors que le projet
            déclare une autre clé. Vérifiez que la signature héritée du gabarit React Native a bien
            été retirée avant l’apposition — c’est la cause la plus fréquente.
          </Alert>
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2 overflow-hidden">
          <CardHeader
            title="Journal de compilation"
            subtitle={live ? 'Rafraîchi toutes les 3 secondes.' : 'Seule la fin du journal est conservée en mémoire (400 Ko).'}
            action={
              <label className="flex items-center gap-1.5 text-[12.5px]" style={{ color: 'var(--ink-3)' }}>
                <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} />
                Suivre la fin
              </label>
            }
          />
          <pre ref={logRef}
            className="max-h-[560px] overflow-auto px-5 pb-5 text-[12px] leading-[1.55]"
            style={{ fontFamily: 'var(--font-mono)', color: 'var(--ink-2)' }}>
            {logData?.log || (live ? 'En attente des premières lignes…' : 'Aucun journal disponible.')}
          </pre>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Résumé" />
            <dl className="space-y-0 border-t" style={{ borderColor: 'var(--line)' }}>
              <Row label="État">
                <Badge tone={st.tone} pulse={build.status === 'running'}>{st.label}</Badge>
              </Row>
              <Row label="Origine">{build.source}{build.triggeredBy ? ` · ${build.triggeredBy}` : ''}</Row>
              <Row label="Mise en file">{fullDate(build.createdAt)}</Row>
              <Row label="Démarré">{fullDate(build.startedAt)}</Row>
              <Row label="Terminé">{fullDate(build.finishedAt)}</Row>
              <Row label="Durée">{duration(build.durationSec)}</Row>
            </dl>
          </Card>

          <Card>
            <CardHeader title="Artefact" />
            <dl className="space-y-0 border-t" style={{ borderColor: 'var(--line)' }}>
              <Row label="Fichier">{build.apkName || '—'}</Row>
              <Row label="Taille">{bytes(build.apkSize)}</Row>
              <Row label="Version">{build.appVersion ? `v${build.appVersion}` : '—'}</Row>
              <Row label="Architectures">{build.abis}</Row>
              <Row label="Tâche Gradle"><code>{build.gradleTask}</code></Row>
              <Row label="Sous-dossier"><code>{build.appSubdir}</code></Row>
            </dl>
          </Card>

          <Card>
            <CardHeader title="Signature"
              subtitle="Empreinte réellement apposée, relevée par apksigner à la fin du build." />
            <div className="border-t px-5 py-4" style={{ borderColor: 'var(--line)' }}>
              {build.signedWith ? (
                <>
                  <code className="block break-all text-[12px] tnum" style={{ color: 'var(--ink-2)' }}>
                    {fingerprint(build.signedWith)}
                  </code>
                  {build.signatureMatchesProject && (
                    <p className="mt-2 text-[12.5px]" style={{ color: 'var(--ok-ink)' }}>
                      Conforme à la clé enregistrée sur le projet.
                    </p>
                  )}
                </>
              ) : (
                <div className="flex gap-2.5 text-[12.5px] leading-relaxed" style={{ color: 'var(--ink-2)' }}>
                  <span style={{ color: 'var(--warn)' }}><IconAlert size={16} /></span>
                  <span>
                    Signé avec la clé de debug. Cet APK ne peut pas remplacer une version
                    antérieure signée autrement, et la clé disparaît si le cache du serveur
                    est vidé.
                  </span>
                </div>
              )}
            </div>
          </Card>

          {build.downloadUrl && (
            <Card>
              <CardHeader title="Lien de téléchargement"
                subtitle="Public et permanent — toute personne disposant de l’adresse peut installer l’application." />
              <div className="border-t px-5 py-4" style={{ borderColor: 'var(--line)' }}>
                <code className="block break-all text-[11.5px]" style={{ color: 'var(--ink-2)' }}>
                  {build.downloadUrl}
                </code>
                <Button size="sm" className="mt-3"
                  onClick={() => navigator.clipboard?.writeText(build.downloadUrl!)}>
                  Copier le lien
                </Button>
              </div>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b px-5 py-2.5 last:border-b-0"
      style={{ borderColor: 'var(--line)' }}>
      <dt className="shrink-0 text-[12.5px]" style={{ color: 'var(--ink-3)' }}>{label}</dt>
      <dd className="min-w-0 truncate text-right text-[13px]" style={{ color: 'var(--ink)' }}>{children}</dd>
    </div>
  );
}
