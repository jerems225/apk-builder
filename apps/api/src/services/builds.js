'use strict';
const fs = require('fs');
const path = require('path');
const prisma = require('../lib/prisma');
const config = require('../config');

/**
 * Met un build en file. Les réglages effectifs (sous-dossier, tâche Gradle,
 * architectures) sont figés ici, à partir du projet : un build reste
 * reproductible même si le projet est modifié entre-temps.
 *
 * La clé de signature, elle, est résolue au démarrage du build et non ici —
 * remplacer une clé doit s'appliquer aux builds encore en attente.
 */
async function enqueue({ workspace, project, job, source }) {
  const build = await prisma.build.create({
    data: {
      workspaceId: workspace.id,
      projectId: project ? project.id : null,
      repoUrl: job.repoUrl || (project && project.repoUrl),
      repoName: job.repoName || (project && project.repoName),
      ref: job.ref,
      refType: job.refType === 'tag' ? 'tag' : 'branch',
      commitSha: job.commitSha || null,
      triggeredBy: job.triggeredBy || 'inconnu',
      source,
      appSubdir: job.appSubdir || (project && project.appSubdir) || config.appSubdir,
      gradleTask: job.gradleTask || (project && project.gradleTask) || config.gradleTask,
      abis: job.abis || (project && project.abis) || config.abis,
      status: 'queued',
    },
  });
  console.log(
    `[api] file d'attente ${build.id} — ${build.repoName}@${build.ref} ` +
    `(${source}, espace=${workspace.slug}, task=${build.gradleTask}, abis=${build.abis})`);
  return build;
}

const artifactDir = (buildId) => path.join(config.paths.artifacts, buildId);

/** Suppression complète : artefacts sur disque puis ligne en base. */
async function remove(buildId) {
  fs.rmSync(artifactDir(buildId), { recursive: true, force: true });
  await prisma.build.delete({ where: { id: buildId } }).catch(() => {});
}

/**
 * Lit la fin du journal. Les logs Gradle atteignent facilement plusieurs Mo :
 * on n'envoie que la fin, qui contient l'erreur, et on le dit explicitement
 * plutôt que de laisser croire au journal complet.
 */
function readLog(buildId, maxBytes = 400_000) {
  const file = path.join(artifactDir(buildId), 'build.log');
  if (!fs.existsSync(file)) return '';
  const buf = fs.readFileSync(file, 'utf8');
  if (buf.length <= maxBytes) return buf;
  const mb = (buf.length / 1024 / 1024).toFixed(1);
  return `[… ${mb} Mo tronqués, fin du journal …]\n\n${buf.slice(-maxBytes)}`;
}

/** Statistiques d'en-tête du tableau de bord, en une seule passe SQL. */
async function statsFor(workspaceId, days = 30) {
  const since = new Date(Date.now() - days * 86400 * 1000);
  const previousSince = new Date(Date.now() - 2 * days * 86400 * 1000);

  const [current, previous, byStatus, recent] = await Promise.all([
    prisma.build.findMany({
      where: { workspaceId, createdAt: { gte: since } },
      select: { status: true, apkSize: true, createdAt: true, startedAt: true, finishedAt: true },
    }),
    prisma.build.findMany({
      where: { workspaceId, createdAt: { gte: previousSince, lt: since } },
      select: { status: true, apkSize: true, startedAt: true, finishedAt: true },
    }),
    prisma.build.groupBy({
      by: ['status'],
      where: { workspaceId },
      _count: { _all: true },
    }),
    prisma.build.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' },
      take: 8,
      include: { project: { select: { name: true } } },
    }),
  ]);

  const summarize = (rows) => {
    const done = rows.filter((b) => b.status === 'success' || b.status === 'failed');
    const ok = rows.filter((b) => b.status === 'success');
    const durations = ok
      .filter((b) => b.startedAt && b.finishedAt)
      .map((b) => (b.finishedAt - b.startedAt) / 1000);
    return {
      total: rows.length,
      success: ok.length,
      failed: rows.filter((b) => b.status === 'failed').length,
      // Taux calculé sur les builds terminés seulement : compter les builds en
      // file comme des échecs ferait chuter le chiffre à chaque mise en file.
      successRate: done.length ? Math.round((ok.length / done.length) * 100) : 0,
      avgDuration: durations.length
        ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
        : 0,
      avgSize: ok.length
        ? Math.round(ok.reduce((a, b) => a + (b.apkSize || 0), 0) / ok.length)
        : 0,
    };
  };

  // Série journalière pour le graphique : on part d'un tableau plein de zéros,
  // sinon les jours sans build disparaissent de la courbe et faussent la lecture.
  const series = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400 * 1000);
    series.push({ date: d.toISOString().slice(0, 10), success: 0, failed: 0, total: 0 });
  }
  const index = new Map(series.map((p) => [p.date, p]));
  for (const b of current) {
    const p = index.get(b.createdAt.toISOString().slice(0, 10));
    if (!p) continue;
    p.total++;
    if (b.status === 'success') p.success++;
    else if (b.status === 'failed') p.failed++;
  }

  return {
    period: { days, since: since.toISOString() },
    current: summarize(current),
    previous: summarize(previous),
    byStatus: Object.fromEntries(byStatus.map((r) => [r.status, r._count._all])),
    series,
    recent,
  };
}

module.exports = { enqueue, remove, readLog, artifactDir, statsFor };
