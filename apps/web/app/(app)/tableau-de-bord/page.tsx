'use client';

import React from 'react';
import Link from 'next/link';
import { useResource, useSession } from '@/components/session';
import { PageHeader } from '@/components/shell';
import { Card, CardHeader, Badge, Delta, Button, Skeleton, EmptyState, Alert, Select } from '@/components/ui';
import { ActivityChart, Gauge, RankBars } from '@/components/charts';
import {
  IconBuilds, IconCheck, IconClock, IconDownload, IconPlus, IconAlert, IconKey,
} from '@/components/ui/icons';
import { bytes, duration, number, relative, delta, STATUS } from '@/lib/format';
import type { Stats } from '@/lib/types';

export default function DashboardPage() {
  const { workspace, can } = useSession();
  const [days, setDays] = React.useState(30);

  // Rafraîchissement toutes les 10 s : pendant un build, l'écran doit bouger
  // sans qu'on ait à recharger la page.
  const { data, loading, error } = useResource<Stats>(`/api/stats?days=${days}`, [days], 10000);

  if (error) {
    return <Alert tone="danger" title="Chargement impossible">{error}</Alert>;
  }

  return (
    <>
      <PageHeader
        title="Tableau de bord"
        subtitle={workspace ? `Espace « ${workspace.name} » — ${days} derniers jours` : undefined}
        actions={
          <>
            <Select value={days} onChange={(e) => setDays(Number(e.target.value))}
              className="w-auto min-w-[150px]">
              <option value={7}>7 derniers jours</option>
              <option value={30}>30 derniers jours</option>
              <option value={90}>90 derniers jours</option>
            </Select>
            {can('DEVELOPER') && (
              <Link href="/builds?nouveau=1">
                <Button variant="primary" icon={<IconPlus size={16} />}>Lancer un build</Button>
              </Link>
            )}
          </>
        }
      />

      {loading && !data ? <DashboardSkeleton /> : data ? <Dashboard data={data} /> : null}
    </>
  );
}

function Dashboard({ data }: { data: Stats }) {
  const { current, previous } = data;

  return (
    <div className="space-y-4">
      {/* Bandeau d'alerte : projets sans clé de release. Placé avant les
          chiffres parce que c'est actionnable, contrairement à eux. */}
      {data.projects.unsigned > 0 && (
        <Alert tone="warn" title={
          `${data.projects.unsigned} projet${data.projects.unsigned > 1 ? 's' : ''} sans clé de signature`
        }>
          Leurs APK conservent la clé de debug : impubliables, et impossibles à installer
          par-dessus une version antérieure dès que le cache du serveur est vidé.{' '}
          <Link href="/projets" className="font-semibold underline underline-offset-2">
            Voir les projets concernés
          </Link>
        </Alert>
      )}

      {/* ── Rangée d'indicateurs ─────────────────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Builds lancés" value={number(current.total)}
          delta={delta(current.total, previous.total)}
          previous={`${number(previous.total)} sur la période précédente`}
          icon={<IconBuilds size={17} />}
        />
        <StatCard
          label="Taux de réussite" value={`${current.successRate} %`}
          delta={delta(current.successRate, previous.successRate)}
          previous={`${previous.successRate} % sur la période précédente`}
          icon={<IconCheck size={17} />}
        />
        <StatCard
          label="Durée moyenne" value={duration(current.avgDuration)}
          delta={delta(current.avgDuration, previous.avgDuration)} invert
          previous={`${duration(previous.avgDuration)} sur la période précédente`}
          icon={<IconClock size={17} />}
        />
        <StatCard
          label="Poids moyen de l’APK" value={bytes(current.avgSize)}
          delta={delta(current.avgSize, previous.avgSize)} invert
          previous={`${bytes(previous.avgSize)} sur la période précédente`}
          icon={<IconDownload size={17} />}
        />
      </div>

      {/* ── Graphiques ───────────────────────────────────────────────────── */}
      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader
            title="Activité de compilation"
            subtitle="Un empilement par jour. Les échecs sont posés au-dessus des réussites pour se lire d’un coup d’œil."
          />
          <ActivityChart data={data.series} />
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader
              title="Taux de réussite"
              subtitle={`${number(current.success)} réussis sur ${number(current.success + current.failed)} terminés`}
            />
            <Gauge value={current.successRate} target={90}
              caption="Le repère pointillé marque l’objectif de 90 %." />
          </Card>

          <Card>
            <CardHeader title="File d’attente" />
            <div className="grid grid-cols-2 gap-px overflow-hidden rounded-b-[14px]"
              style={{ background: 'var(--line)' }}>
              <QueueTile label="Dans cet espace"
                value={`${data.queue.running} / ${data.queue.workspaceLimit}`} />
              <QueueTile label="Sur la machine"
                value={`${data.queue.machineRunning} / ${data.queue.machineLimit}`} />
            </div>
          </Card>
        </div>
      </div>

      {/* ── Bas de page ──────────────────────────────────────────────────── */}
      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader
            title="Derniers builds"
            action={<Link href="/builds" className="text-[12.5px] font-semibold"
              style={{ color: 'var(--accent)' }}>Tout l’historique →</Link>}
          />
          {data.recent.length === 0 ? (
            <EmptyState icon={<IconBuilds size={20} />} title="Aucun build pour l’instant"
              description="Enregistrez un projet, puis lancez un build ou poussez sur une branche surveillée." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr style={{ background: 'var(--surface-sunken)', color: 'var(--ink-3)' }}>
                    <Th className="pl-5">Projet</Th>
                    <Th>Référence</Th>
                    <Th>État</Th>
                    <Th align="right">Taille</Th>
                    <Th align="right">Durée</Th>
                    <Th align="right" className="pr-5">Lancé</Th>
                  </tr>
                </thead>
                <tbody>
                  {data.recent.map((b) => (
                    <tr key={b.id} className="border-t" style={{ borderColor: 'var(--line)' }}>
                      <td className="py-2.5 pl-5 pr-3">
                        <Link href={`/builds/${b.id}`} className="font-medium hover:underline">
                          {b.projectName || b.repoName}
                        </Link>
                        {b.appVersion && (
                          <span className="ml-1.5 text-[12px]" style={{ color: 'var(--ink-3)' }}>
                            v{b.appVersion}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        <code className="rounded px-1.5 py-0.5 text-[12px]"
                          style={{ background: 'var(--surface-sunken)', color: 'var(--ink-2)' }}>
                          {b.ref}
                        </code>
                      </td>
                      <td className="px-3 py-2.5">
                        <Badge tone={STATUS[b.status].tone} pulse={b.status === 'running'}>
                          {STATUS[b.status].label}
                        </Badge>
                      </td>
                      <td className="px-3 py-2.5 text-right tnum" style={{ color: 'var(--ink-2)' }}>
                        {bytes(b.apkSize)}
                      </td>
                      <td className="px-3 py-2.5 text-right tnum" style={{ color: 'var(--ink-2)' }}>
                        {duration(b.durationSec)}
                      </td>
                      <td className="py-2.5 pl-3 pr-5 text-right" style={{ color: 'var(--ink-3)' }}>
                        {relative(b.createdAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card>
          <CardHeader title="Projets les plus compilés" subtitle="Sur la période affichée" />
          {data.topProjects.length === 0 ? (
            <EmptyState icon={<IconKey size={20} />} title="Rien à classer"
              description="Le classement apparaît dès le premier build." />
          ) : (
            <RankBars items={data.topProjects.map((p) => ({ label: p.repoName, value: p.builds }))} />
          )}
        </Card>
      </div>
    </div>
  );
}

// ────────────────────────────── Sous-composants ──────────────────────────────

function StatCard({
  label, value, delta: d, previous, icon, invert,
}: {
  label: string; value: string; delta: number | null;
  previous: string; icon: React.ReactNode; invert?: boolean;
}) {
  return (
    <Card className="p-5">
      <div className="mb-3 flex items-start justify-between gap-3">
        <p className="text-[13px] font-medium" style={{ color: 'var(--ink-2)' }}>{label}</p>
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg"
          style={{ background: 'var(--accent-wash)', color: 'var(--accent)' }}>
          {icon}
        </span>
      </div>
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="text-[27px] font-semibold leading-none tracking-[-.02em]">{value}</span>
        <Delta value={d} invert={invert} />
      </div>
      <p className="mt-2 text-[12px]" style={{ color: 'var(--ink-3)' }}>{previous}</p>
    </Card>
  );
}

function QueueTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-5 py-4" style={{ background: 'var(--surface)' }}>
      <p className="text-[12px]" style={{ color: 'var(--ink-3)' }}>{label}</p>
      <p className="mt-1 text-[19px] font-semibold tnum">{value}</p>
    </div>
  );
}

function Th({
  children, align = 'left', className,
}: { children: React.ReactNode; align?: 'left' | 'right'; className?: string }) {
  return (
    <th className={`px-3 py-2 text-[11.5px] font-semibold uppercase tracking-wide ${
      align === 'right' ? 'text-right' : 'text-left'} ${className || ''}`}>
      {children}
    </th>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[118px]" />)}
      </div>
      <div className="grid gap-4 xl:grid-cols-3">
        <Skeleton className="h-[300px] xl:col-span-2" />
        <Skeleton className="h-[300px]" />
      </div>
    </div>
  );
}
