'use strict';
const express = require('express');
const { z } = require('zod');
const prisma = require('../lib/prisma');
const auth = require('../lib/auth');
const audit = require('../lib/audit');
const worker = require('../worker');
const buildsService = require('../services/builds');
const transfer = require('../services/transfer');
const config = require('../config');
const { asyncRoute, parseBody, notFound, conflict, badRequest } = require('../lib/http');

const router = express.Router();
router.use(auth.requireAuth, auth.resolveWorkspace);

const publicBuild = (b) => ({
  id: b.id,
  projectId: b.projectId,
  projectName: b.project ? b.project.name : null,
  repoName: b.repoName,
  repoUrl: b.repoUrl,
  ref: b.ref,
  refType: b.refType,
  commitSha: b.commitSha,
  triggeredBy: b.triggeredBy,
  source: b.source,
  status: b.status,
  appSubdir: b.appSubdir,
  gradleTask: b.gradleTask,
  abis: b.abis,
  apkName: b.apkName,
  apkSize: b.apkSize,
  appVersion: b.appVersion,
  signedWith: b.signedWith,
  // Relevés sur l'APK lui-même. applicationId et versionCode sont exposés
  // parce que ce sont eux, et non le nom du dépôt, qui décident si une
  // installation aboutit sur un téléphone donné.
  applicationId: b.applicationId,
  versionCode: b.versionCode,
  signatureSchemes: b.signatureSchemes,
  apkAbis: b.apkAbis,
  minSdk: b.minSdk,
  targetSdk: b.targetSdk,
  identityWarning: b.identityWarning,
  exitCode: b.exitCode,
  error: b.error,
  createdAt: b.createdAt,
  startedAt: b.startedAt,
  finishedAt: b.finishedAt,
  durationSec: b.startedAt && b.finishedAt
    ? Math.round((b.finishedAt - b.startedAt) / 1000)
    : null,
  downloadUrl: b.apkName ? `${config.publicUrl}/dl/${b.id}/${encodeURIComponent(b.apkName)}` : null,
});

// ──────────────────────────────── Lecture ────────────────────────────────────

router.get('/', asyncRoute(async (req, res) => {
  const take = Math.min(Number(req.query.limit) || 50, 200);
  const where = { workspaceId: req.workspace.id };
  if (req.query.status) where.status = String(req.query.status);
  if (req.query.projectId) where.projectId = String(req.query.projectId);
  if (req.query.q) {
    const q = String(req.query.q);
    where.OR = [{ repoName: { contains: q } }, { ref: { contains: q } }];
  }

  const [items, total] = await Promise.all([
    prisma.build.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take,
      skip: Math.max(Number(req.query.offset) || 0, 0),
      include: { project: { select: { name: true } } },
    }),
    prisma.build.count({ where }),
  ]);
  res.json({ total, items: items.map(publicBuild) });
}));

router.get('/:id', asyncRoute(async (req, res) => {
  const build = await prisma.build.findFirst({
    where: { id: req.params.id, workspaceId: req.workspace.id },
    include: { project: { select: { name: true, keystoreFingerprint: true } } },
  });
  if (!build) throw notFound('Build introuvable dans cet espace.');
  res.json({
    ...publicBuild(build),
    // Comparer l'empreinte apposée à celle enregistrée sur le projet : une
    // divergence signale une signature qui a changé sans qu'on l'ait voulu.
    signatureMatchesProject: build.signedWith && build.project
      ? normalizeFp(build.signedWith) === normalizeFp(build.project.keystoreFingerprint)
      : null,
    isActive: worker.isActive(build.id),
  });
}));

const normalizeFp = (v) => String(v || '').toUpperCase().replace(/[^0-9A-F]/g, '');

/** Journal du build. Séparé du détail : plusieurs centaines de Ko à chaque appel. */
router.get('/:id/log', asyncRoute(async (req, res) => {
  const build = await prisma.build.findFirst({
    where: { id: req.params.id, workspaceId: req.workspace.id },
    select: { id: true, status: true },
  });
  if (!build) throw notFound('Build introuvable dans cet espace.');
  res.json({
    id: build.id,
    status: build.status,
    isActive: worker.isActive(build.id),
    log: buildsService.readLog(build.id),
  });
}));

// ─────────────────────────────── Déclenchement ───────────────────────────────

const createSchema = z.object({
  projectId: z.string().uuid().optional(),
  repoUrl: z.string().trim().url().optional(),
  repoName: z.string().trim().max(200).optional(),
  ref: z.string().trim().min(1, 'Branche ou tag obligatoire').max(200),
  refType: z.enum(['branch', 'tag']).default('branch'),
  appSubdir: z.string().trim().max(200).optional(),
  gradleTask: z.string().trim().max(80).optional(),
  abis: z.string().trim().max(80).optional(),
});

/**
 * Création d'un build. Extrait de la route pour être réutilisé tel quel par
 * l'entrée machine (`POST /api/ci/builds`) : les deux diffèrent uniquement par
 * la façon dont l'appelant est authentifié, pas par ce qu'elles font.
 */
const createBuild = asyncRoute(async (req, res) => {
  const body = parseBody(createSchema, req.body);

  let project = null;
  if (body.projectId) {
    project = await prisma.project.findFirst({
      where: { id: body.projectId, workspaceId: req.workspace.id },
    });
    if (!project) throw notFound('Projet introuvable dans cet espace.');
    if (!project.enabled) throw conflict('Ce projet est désactivé : réactivez-le avant de lancer un build.');
  }

  const repoUrl = body.repoUrl || (project && project.repoUrl);
  if (!repoUrl) throw badRequest('Indiquez un projet ou une URL de dépôt.');
  if (!/^https?:\/\//i.test(repoUrl)) throw badRequest('L’URL doit être une adresse HTTP(S) de clone.');

  const build = await buildsService.enqueue({
    workspace: req.workspace,
    project,
    job: {
      repoUrl,
      repoName: body.repoName || (project && project.repoName) ||
        repoUrl.replace(/^https?:\/\/[^/]+\//, '').replace(/\.git$/, ''),
      ref: body.ref,
      refType: body.refType,
      appSubdir: body.appSubdir,
      gradleTask: body.gradleTask,
      abis: body.abis,
      triggeredBy: req.user ? req.user.name : 'interface',
    },
    source: 'manuel',
  });

  audit.record(req, 'build.create', build.id, { repoName: build.repoName, ref: build.ref });
  res.status(202).json(publicBuild(build));
});

router.post('/', auth.requireRole('DEVELOPER'), createBuild);

/** Relance à l'identique. Utile après un échec d'infrastructure. */
router.post('/:id/rerun', auth.requireRole('DEVELOPER'), asyncRoute(async (req, res) => {
  const source = await prisma.build.findFirst({
    where: { id: req.params.id, workspaceId: req.workspace.id },
    include: { project: true },
  });
  if (!source) throw notFound('Build introuvable dans cet espace.');

  const build = await buildsService.enqueue({
    workspace: req.workspace,
    project: source.project,
    job: {
      repoUrl: source.repoUrl,
      repoName: source.repoName,
      ref: source.ref,
      refType: source.refType,
      appSubdir: source.appSubdir,
      gradleTask: source.gradleTask,
      abis: source.abis,
      triggeredBy: req.user ? req.user.name : 'interface',
    },
    source: 'relance',
  });
  audit.record(req, 'build.rerun', build.id, { from: source.id });
  res.status(202).json(publicBuild(build));
}));

router.post('/:id/cancel', auth.requireRole('DEVELOPER'), asyncRoute(async (req, res) => {
  const build = await prisma.build.findFirst({
    where: { id: req.params.id, workspaceId: req.workspace.id },
  });
  if (!build) throw notFound('Build introuvable dans cet espace.');

  if (build.status === 'queued') {
    // Un build encore en file n'a pas de conteneur à tuer : il suffit de le
    // sortir de la file avant que le worker ne le réclame.
    await prisma.build.updateMany({
      where: { id: build.id, status: 'queued' },
      data: { status: 'cancelled', error: 'Annulé avant démarrage', finishedAt: new Date() },
    });
  } else if (build.status === 'running') {
    if (!worker.cancel(build.id)) {
      throw conflict('Ce build n’est plus piloté par ce service (redémarrage ?). Rafraîchissez la page.');
    }
  } else {
    throw conflict('Ce build est déjà terminé.');
  }

  audit.record(req, 'build.cancel', build.id);
  res.json({ ok: true });
}));

router.delete('/:id', auth.requireRole('MAINTAINER'), asyncRoute(async (req, res) => {
  const build = await prisma.build.findFirst({
    where: { id: req.params.id, workspaceId: req.workspace.id },
  });
  if (!build) throw notFound('Build introuvable dans cet espace.');
  if (build.status === 'running') {
    throw conflict('Build en cours : interrompez-le avant de le supprimer.');
  }
  await buildsService.remove(build.id);
  audit.record(req, 'build.delete', build.id, { repoName: build.repoName });
  res.json({ ok: true });
}));

const transferSchema = z.object({
  buildIds: z.array(z.string().uuid()).min(1, 'Sélectionnez au moins un build'),
  targetWorkspaceId: z.string().min(1, 'Espace cible obligatoire'),
  targetProjectId: z.string().uuid().nullable().optional(),
});

/**
 * Déplace des builds vers un autre espace de travail.
 *
 * Rôle propriétaire **dans les deux espaces** : l'exiger d'un seul côté
 * permettrait soit de verser les builds d'un client dans un espace qu'on
 * contrôle, soit d'aspirer ceux d'un espace voisin.
 */
router.post('/transfer', auth.requireRole('OWNER'), asyncRoute(async (req, res) => {
  const body = parseBody(transferSchema, req.body);
  const r = await transfer.transfererBuilds({
    user: req.user,
    source: req.workspace,
    cibleId: body.targetWorkspaceId,
    buildIds: body.buildIds,
    targetProjectId: body.targetProjectId || null,
  });

  // Tracé des deux côtés : sans la trace côté cible, des builds apparaîtraient
  // dans un espace sans que rien n'explique d'où ils viennent.
  audit.record(req, 'build.transfer.out', null,
    { vers: r.cible.slug, nombre: r.transferes, depots: r.depots });
  // Objet minimal plutôt qu'une copie de la requête : audit.record ne lit que
  // ces trois champs, et étaler un objet Express recopie mal ses accesseurs.
  audit.record({ workspace: { id: r.cible.id }, user: req.user, ip: req.ip },
    'build.transfer.in', null,
    { depuis: req.workspace.slug, nombre: r.transferes, depots: r.depots });

  res.json({
    ok: true,
    ...r,
    avertissement: r.projet
      ? null
      : 'Ces builds sont arrivés sans projet d’accueil : leur historique et leurs liens de ' +
        'téléchargement restent intacts, mais ils ne sont plus rattachés à des réglages.',
  });
}));

/** Ménage groupé des échecs. Demandé en permanence, autant l'outiller. */
router.post('/purge-failed', auth.requireRole('MAINTAINER'), asyncRoute(async (req, res) => {
  const failed = await prisma.build.findMany({
    where: { workspaceId: req.workspace.id, status: { in: ['failed', 'cancelled'] } },
    select: { id: true },
  });
  for (const b of failed) await buildsService.remove(b.id);
  audit.record(req, 'build.purge_failed', null, { count: failed.length });
  res.json({ ok: true, deleted: failed.length });
}));

module.exports = { router, publicBuild, createBuild };
