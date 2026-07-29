'use strict';
const express = require('express');
const prisma = require('../lib/prisma');
const auth = require('../lib/auth');
const worker = require('../worker');
const buildsService = require('../services/builds');
const config = require('../config');
const { asyncRoute } = require('../lib/http');

const router = express.Router();
router.use(auth.requireAuth, auth.resolveWorkspace);

/**
 * Données du tableau de bord. Un seul appel : découper en quatre requêtes
 * côté navigateur multiplierait les allers-retours pour un affichage qui doit
 * apparaître d'un bloc.
 */
router.get('/', asyncRoute(async (req, res) => {
  const days = Math.min(Math.max(Number(req.query.days) || 30, 7), 90);
  const [stats, projectCount, activeProjects, topProjects] = await Promise.all([
    buildsService.statsFor(req.workspace.id, days),
    prisma.project.count({ where: { workspaceId: req.workspace.id } }),
    prisma.project.count({ where: { workspaceId: req.workspace.id, enabled: true } }),
    prisma.build.groupBy({
      by: ['projectId', 'repoName'],
      where: {
        workspaceId: req.workspace.id,
        createdAt: { gte: new Date(Date.now() - days * 86400 * 1000) },
      },
      _count: { _all: true },
      orderBy: { _count: { projectId: 'desc' } },
      take: 6,
    }),
  ]);

  // Projets sans clé de release : c'est le chiffre qui pilote le chantier de
  // signature, et le laisser visible évite qu'il soit oublié.
  const unsigned = await prisma.project.count({
    where: { workspaceId: req.workspace.id, enabled: true, keystoreAlias: null },
  });

  res.json({
    ...stats,
    projects: { total: projectCount, active: activeProjects, unsigned },
    queue: {
      running: worker.activeFor(req.workspace.id),
      machineRunning: worker.activeCount(),
      machineLimit: config.maxConcurrent,
      workspaceLimit: req.workspace.maxConcurrent,
    },
    topProjects: topProjects.map((t) => ({
      projectId: t.projectId,
      repoName: t.repoName,
      builds: t._count._all,
    })),
    recent: stats.recent.map((b) => ({
      id: b.id,
      repoName: b.repoName,
      projectName: b.project ? b.project.name : null,
      ref: b.ref,
      status: b.status,
      apkSize: b.apkSize,
      appVersion: b.appVersion,
      createdAt: b.createdAt,
      durationSec: b.startedAt && b.finishedAt
        ? Math.round((b.finishedAt - b.startedAt) / 1000)
        : null,
    })),
  });
}));

module.exports = router;
