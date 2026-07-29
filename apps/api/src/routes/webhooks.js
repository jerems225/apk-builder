'use strict';
const express = require('express');
const prisma = require('../lib/prisma');
const secrets = require('../lib/crypto');
const hook = require('../lib/webhook');
const buildsService = require('../services/builds');
const config = require('../config');
const { asyncRoute } = require('../lib/http');

const router = express.Router();

/**
 * Point d'entrée des webhooks Git, un par espace de travail.
 *
 * Pourquoi l'espace est dans l'URL : depuis le passage en multi-utilisateurs,
 * un même dépôt peut être enregistré dans plusieurs espaces. Résoudre par le
 * seul nom du dépôt serait ambigu, et un secret global permettrait au webhook
 * d'un client de déclencher un build chez un autre.
 */
async function handle(req, res, workspace) {
  if (!workspace || !workspace.isActive) {
    return res.status(404).json({ error: 'espace de travail inconnu ou désactivé' });
  }

  let secret = '';
  if (workspace.webhookSecretEnc) {
    try { secret = secrets.decrypt(workspace.webhookSecretEnc); }
    catch (e) { console.error(`[hook] secret illisible pour '${workspace.slug}' — ${e.message}`); }
  } else if (config.legacyWebhookSecret) {
    // Repli sur le secret global du .env, le temps que les espaces créés avant
    // la migration reçoivent le leur.
    secret = config.legacyWebhookSecret;
  }

  const auth = hook.verify(req, secret);
  if (!auth.ok) {
    const ct = req.get('content-type') || '(absent)';
    const n = req.rawBody ? req.rawBody.length : 0;
    console.warn(`[hook] refusé (${workspace.slug}): ${auth.reason} — content-type=${ct}, ${n} octets`);
    // Ce corps de réponse s'affiche dans l'onglet « Recent Deliveries » de
    // GitHub : autant y mettre de quoi corriger sans ouvrir le serveur.
    return res.status(401).json({
      error: auth.reason,
      aide: 'Vérifiez que le secret du webhook est identique à celui affiché dans ' +
        'Paramètres → Webhook (sans espace avant/après) et que Content type vaut application/json.',
      content_type_recu: ct,
      octets_recus: n,
    });
  }

  // Le ping d'installation GitHub ne doit pas déclencher de build mais doit
  // répondre 200, sinon GitHub marque le webhook en erreur.
  if (req.headers['x-github-event'] === 'ping') {
    return res.json({ ok: true, message: `webhook opérationnel pour l’espace « ${workspace.name} »` });
  }

  // Webhook réglé sur « x-www-form-urlencoded » : GitHub enveloppe le JSON
  // dans un champ `payload`. On le déballe pour que la suite soit identique.
  let body = req.body || {};
  if (typeof body.payload === 'string') {
    try { body = JSON.parse(body.payload); }
    catch { return res.status(400).json({ error: 'champ payload illisible' }); }
  }

  const job = hook.parse(body, req.headers);
  if (!job) return res.json({ ok: true, skipped: 'évènement non pris en charge' });

  const project = await prisma.project.findFirst({
    where: { workspaceId: workspace.id, repoName: job.repoName },
  });

  const reject = hook.shouldBuild(job, project);
  if (reject) {
    console.log(`[hook] ignoré (${workspace.slug}) : ${reject}`);
    return res.json({ ok: true, skipped: reject });
  }

  const build = await buildsService.enqueue({ workspace, project, job, source: 'webhook' });
  res.status(202).json({
    ok: true,
    build_id: build.id,
    status_url: `${config.publicUrl}/builds/${build.id}`,
  });
}

router.post('/:slug', asyncRoute(async (req, res) => {
  const workspace = await prisma.workspace.findUnique({ where: { slug: req.params.slug } });
  await handle(req, res, workspace);
}));

/**
 * Ancienne route, sans espace dans l'URL. Conservée pour ne pas casser les
 * webhooks déjà configurés chez les clients : elle vise l'espace désigné par
 * LEGACY_WORKSPACE_SLUG, à défaut le plus ancien.
 *
 * À retirer une fois tous les hooks migrés — la trace ci-dessous permet de
 * savoir quand ce sera le cas.
 */
const legacy = asyncRoute(async (req, res) => {
  const workspace = config.legacyWorkspaceSlug
    ? await prisma.workspace.findUnique({ where: { slug: config.legacyWorkspaceSlug } })
    : await prisma.workspace.findFirst({ orderBy: { createdAt: 'asc' } });

  if (workspace) {
    console.warn(`[hook] appel sur l'ancienne route /webhook — à migrer vers ` +
      `${config.publicUrl}/api/webhooks/${workspace.slug}`);
  }
  await handle(req, res, workspace);
});

module.exports = { router, legacy };
