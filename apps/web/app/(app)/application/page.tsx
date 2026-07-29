'use client';

import React from 'react';
import { useResource } from '@/components/session';
import { PageHeader } from '@/components/shell';
import { Card, CardHeader, Button, Alert, Skeleton, EmptyState, Badge } from '@/components/ui';
import { Logo } from '@/components/ui/logo';
import { IconDownload, IconAlert, IconCheck } from '@/components/ui/icons';
import { bytes, fullDate } from '@/lib/format';

interface Installateur {
  nom: string;
  format: 'exe' | 'msi' | 'portable' | 'mac' | 'linux';
  libelle: string;
  detail: string;
  version: string | null;
  taille: number;
  publieLe: string;
  url: string;
}

export default function ApplicationPage() {
  const { data, loading } = useResource<{
    disponible: boolean;
    fichiers: Installateur[];
    aide: string | null;
  }>('/api/desktop');

  return (
    <>
      <PageHeader
        title="Application de bureau"
        subtitle="La même interface, dans sa propre fenêtre, avec des notifications système quand un build se termine."
      />

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Card>
            <div className="flex flex-wrap items-center gap-4 p-5">
              <Logo size={52} />
              <div className="min-w-0 flex-1">
                <h2 className="text-[16px] font-semibold">Buildex pour Windows</h2>
                <p className="mt-0.5 text-[13px]" style={{ color: 'var(--ink-3)' }}>
                  {data?.fichiers[0]?.version
                    ? `Version ${data.fichiers[0].version}`
                    : 'Version non publiée'}
                </p>
              </div>
            </div>

            <div className="border-t" style={{ borderColor: 'var(--line)' }}>
              {loading && !data ? (
                <div className="space-y-2 p-4">
                  {[0, 1].map((i) => <Skeleton key={i} className="h-16" />)}
                </div>
              ) : !data?.disponible ? (
                <EmptyState
                  icon={<IconDownload size={20} />}
                  title="Aucun installateur publié"
                  description={data?.aide ??
                    'Les installateurs n’ont pas encore été déposés sur ce serveur.'}
                />
              ) : (
                <ul>
                  {data.fichiers.map((f) => (
                    <li key={f.nom}
                      className="flex flex-wrap items-center gap-4 border-b px-5 py-4 last:border-b-0"
                      style={{ borderColor: 'var(--line)' }}>
                      <div className="min-w-0 flex-1">
                        <p className="flex flex-wrap items-center gap-2 text-[14px] font-semibold">
                          {f.libelle}
                          {f.format === 'exe' && <Badge tone="run">recommandé</Badge>}
                        </p>
                        <p className="mt-0.5 text-[12.5px] leading-snug" style={{ color: 'var(--ink-3)' }}>
                          {f.detail}
                        </p>
                        <p className="mt-1 text-[11.5px]" style={{ color: 'var(--ink-3)' }}>
                          <code>{f.nom}</code> · {bytes(f.taille)} · publié le {fullDate(f.publieLe)}
                        </p>
                      </div>
                      <a href={f.url} download className="shrink-0">
                        <Button variant={f.format === 'exe' ? 'primary' : 'secondary'}
                          icon={<IconDownload size={16} />}>
                          Télécharger
                        </Button>
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>

          {/* L'avertissement SmartScreen est la première question du support :
              autant y répondre avant qu'elle soit posée. */}
          <Alert tone="warn" title="Windows affichera un avertissement à la première exécution">
            Les installateurs ne sont pas signés par un certificat d’éditeur — il se loue à
            l’année et ne change rien à ce que fait le programme. SmartScreen affiche donc
            « L’ordinateur a été protégé ». Cliquez sur <strong>Informations complémentaires</strong>,
            puis sur <strong>Exécuter quand même</strong>. Vérifiez simplement que vous avez
            téléchargé le fichier depuis cette page, et non reçu par courriel.
          </Alert>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Ce que la version de bureau apporte" />
            <ul className="space-y-3 border-t px-5 py-4 text-[13px] leading-relaxed"
              style={{ borderColor: 'var(--line)', color: 'var(--ink-2)' }}>
              <Point>
                <strong>Notifications système</strong> quand un build se termine, même quand la
                fenêtre est en arrière-plan.
              </Point>
              <Point>
                <strong>Téléchargements rangés</strong> directement dans votre dossier, sans
                boîte de dialogue à chaque APK.
              </Point>
              <Point>
                <strong>Une fenêtre à elle</strong>, qui ne se perd pas au milieu de trente
                onglets.
              </Point>
            </ul>
          </Card>

          <Card>
            <CardHeader title="Ce qu’elle n’est pas" />
            <div className="border-t px-5 py-4 text-[13px] leading-relaxed"
              style={{ borderColor: 'var(--line)', color: 'var(--ink-2)' }}>
              <p className="flex gap-2.5">
                <span className="mt-0.5 shrink-0" style={{ color: 'var(--warn)' }}>
                  <IconAlert size={16} />
                </span>
                <span>
                  Ce n’est pas une copie hors ligne. L’application affiche l’interface servie par
                  ce serveur : sans réseau, elle n’affiche rien — et c’est cohérent, puisque la
                  compilation, les clés et les artefacts vivent ici.
                </span>
              </p>
              <p className="mt-3">
                La contrepartie est agréable : une mise à jour de l’interface profite
                immédiatement à tout le monde, <strong>sans réinstaller</strong>. Seule la
                coquille demanderait une nouvelle installation, et elle change rarement.
              </p>
            </div>
          </Card>

          <Card>
            <CardHeader title="Installer sans installateur"
              subtitle="Depuis un navigateur, sans droits particuliers." />
            <div className="border-t px-5 py-4 text-[13px] leading-relaxed"
              style={{ borderColor: 'var(--line)', color: 'var(--ink-2)' }}>
              Buildex s’installe aussi comme application web : dans Chrome ou Edge, l’icône
              d’installation apparaît à droite de la barre d’adresse. Sur téléphone, « Ajouter à
              l’écran d’accueil ». Vous y gagnez la fenêtre dédiée, pas les notifications
              système.
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}

function Point({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-2.5">
      <span className="mt-0.5 shrink-0" style={{ color: 'var(--ok)' }}><IconCheck size={15} /></span>
      <span>{children}</span>
    </li>
  );
}
