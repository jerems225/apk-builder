'use strict';
const fs = require('fs');
const path = require('path');
const express = require('express');
const prisma = require('../lib/prisma');
const config = require('../config');
const { asyncRoute } = require('../lib/http');

const router = express.Router();

// Les liens de téléchargement sont PUBLICS et PERMANENTS. C'est un choix
// assumé : les APK sont distribués à des utilisateurs finaux qui n'ont pas de
// compte sur la plateforme, et un lien authentifié rendrait l'installation
// impraticable. La contrepartie à connaître : toute personne disposant de
// l'URL peut télécharger l'application, sans limite de durée.

function sendApk(res, buildId, apkName) {
  // basename() bloque toute tentative de remontée d'arborescence via le nom
  // de fichier fourni dans l'URL.
  const dir = path.join(config.paths.artifacts, buildId);
  const file = path.join(dir, path.basename(apkName));
  if (!file.startsWith(config.paths.artifacts) || !fs.existsSync(file)) {
    return res.status(404).type('text/plain; charset=utf-8')
      .send('Artefact introuvable ou purgé.');
  }
  res.type('application/vnd.android.package-archive');
  res.set('X-Robots-Tag', 'noindex, nofollow');
  res.download(file, path.basename(apkName));
}

router.get('/dl/:id/:file', asyncRoute(async (req, res) => {
  const build = await prisma.build.findUnique({ where: { id: req.params.id } });
  if (!build || !build.apkName) {
    return res.status(404).type('text/plain; charset=utf-8').send('Artefact introuvable ou purgé.');
  }
  sendApk(res, build.id, build.apkName);
}));

/**
 * Lien permanent : /latest/<espace>/<org>/<depot> sert toujours le dernier APK
 * réussi. C'est le lien qu'on distribue, celui qui n'a pas à changer à chaque
 * version.
 */
router.get(/^\/latest\/([^/]+)\/(.+)$/, asyncRoute(async (req, res) => {
  const slug = decodeURIComponent(req.params[0]);
  const repo = decodeURIComponent(req.params[1]).replace(/\.apk$/, '');

  const workspace = await prisma.workspace.findUnique({ where: { slug } });
  if (!workspace) {
    // Repli sur l'ancienne forme /latest/<org>/<depot>, sans espace : le
    // premier segment fait alors partie du nom du dépôt.
    const legacyRepo = `${slug}/${repo}`.replace(/\.apk$/, '');
    const build = await prisma.build.findFirst({
      where: { repoName: legacyRepo, status: 'success', apkName: { not: null } },
      orderBy: { finishedAt: 'desc' },
    });
    if (!build) {
      return res.status(404).type('text/plain; charset=utf-8')
        .send(`Aucun build réussi pour « ${legacyRepo} ».`);
    }
    return sendApk(res, build.id, build.apkName);
  }

  const build = await prisma.build.findFirst({
    where: {
      workspaceId: workspace.id, repoName: repo, status: 'success', apkName: { not: null },
    },
    orderBy: { finishedAt: 'desc' },
  });
  if (!build) {
    return res.status(404).type('text/plain; charset=utf-8')
      .send(`Aucun build réussi pour « ${repo} » dans l’espace « ${slug} ».`);
  }
  sendApk(res, build.id, build.apkName);
}));

module.exports = router;
