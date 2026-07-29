'use strict';
const express = require('express');
const { z } = require('zod');
const prisma = require('../lib/prisma');
const secrets = require('../lib/crypto');
const keystore = require('../lib/keystore');
const auth = require('../lib/auth');
const audit = require('../lib/audit');
const config = require('../config');
const { asyncRoute, parseBody, conflict, notFound, badRequest } = require('../lib/http');

const router = express.Router();

/**
 * Le slug apparaît dans l'URL de webhook. Le contraindre ici évite d'avoir à
 * l'échapper partout ailleurs, et garde des URL lisibles à recopier à la main
 * dans l'interface de GitHub.
 */
// Classe des diacritiques combinants, ecrite en echappements pour rester
// lisible quel que soit l'editeur qui ouvre ce fichier.
const DIACRITICS = /[\u0300-\u036f]/g;
const slugify = (s) =>
  String(s).toLowerCase().normalize('NFD').replace(DIACRITICS, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'espace';

/** Vue d'un espace pour l'interface. Le secret de webhook n'en sort jamais. */
function publicWorkspace(ws, role) {
  return {
    id: ws.id,
    name: ws.name,
    slug: ws.slug,
    role: role || null,
    retentionDays: ws.retentionDays === null ? config.retentionDays : ws.retentionDays,
    retentionInherited: ws.retentionDays === null,
    maxConcurrent: ws.maxConcurrent,
    isActive: ws.isActive,
    webhookUrl: `${config.publicUrl}/api/webhooks/${ws.slug}`,
    webhookSecretHint: ws.webhookSecretHint,
    hasWebhookSecret: !!ws.webhookSecretEnc,
    // L'interface n'offre la génération de clé que si keytool est installé :
    // mieux vaut ne pas proposer un bouton qui échouera.
    keytoolDisponible: keystore.available(),
    createdAt: ws.createdAt,
  };
}

router.use(auth.requireAuth);

/** Espaces accessibles au compte connecté. */
router.get('/', asyncRoute(async (req, res) => {
  if (req.user.isSuperAdmin) {
    const all = await prisma.workspace.findMany({ orderBy: { name: 'asc' } });
    const mine = new Map(req.user.memberships.map((m) => [m.workspaceId, m.role]));
    return res.json(all.map((w) => publicWorkspace(w, mine.get(w.id) || 'OWNER')));
  }
  res.json(req.user.memberships.map((m) => publicWorkspace(m.workspace, m.role)));
}));

const createSchema = z.object({
  name: z.string().trim().min(2, 'Nom trop court').max(80),
  slug: z.string().trim().max(40).optional(),
});

/**
 * Création d'un espace. Réservée au super-administrateur : ouvrir la création
 * à tous ferait de chaque utilisateur un locataire autonome, ce qui n'est pas
 * le modèle — les espaces correspondent à des clients facturés.
 */
router.post('/', auth.requireSuperAdmin, asyncRoute(async (req, res) => {
  const body = parseBody(createSchema, req.body);
  const slug = slugify(body.slug || body.name);

  if (await prisma.workspace.findUnique({ where: { slug } })) {
    throw conflict(`L’identifiant « ${slug} » est déjà pris par un autre espace.`);
  }

  const secret = secrets.randomToken(24);
  const workspace = await prisma.workspace.create({
    data: {
      name: body.name,
      slug,
      webhookSecretEnc: secrets.encrypt(secret),
      webhookSecretHint: secrets.hint(secret),
      memberships: { create: { userId: req.user.id, role: 'OWNER' } },
    },
  });

  req.workspace = workspace;
  audit.record(req, 'workspace.create', workspace.id, { slug });

  // Le secret complet n'est retourné qu'ici, une seule fois. Ensuite, seule
  // son empreinte est lisible — comme pour un token Git.
  res.status(201).json({ ...publicWorkspace(workspace, 'OWNER'), webhookSecret: secret });
}));

// Les routes suivantes portent sur l'espace courant, résolu par l'en-tête
// X-Workspace comme partout ailleurs dans l'API.
router.use(auth.resolveWorkspace);

router.get('/current', asyncRoute(async (req, res) => {
  res.json(publicWorkspace(req.workspace, req.role));
}));

const updateSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  retentionDays: z.number().int().min(0).max(3650).nullable().optional(),
  maxConcurrent: z.number().int().min(1).max(8).optional(),
});

router.patch('/current', auth.requireRole('OWNER'), asyncRoute(async (req, res) => {
  const body = parseBody(updateSchema, req.body);
  const ws = await prisma.workspace.update({ where: { id: req.workspace.id }, data: body });
  audit.record(req, 'workspace.update', ws.id, body);
  res.json(publicWorkspace(ws, req.role));
}));

/**
 * Régénère le secret de webhook. Action volontairement explicite : elle casse
 * immédiatement tous les webhooks déjà configurés chez le fournisseur Git, il
 * faut recopier le nouveau secret partout.
 */
router.post('/current/webhook-secret', auth.requireRole('OWNER'), asyncRoute(async (req, res) => {
  const secret = secrets.randomToken(24);
  const ws = await prisma.workspace.update({
    where: { id: req.workspace.id },
    data: { webhookSecretEnc: secrets.encrypt(secret), webhookSecretHint: secrets.hint(secret) },
  });
  audit.record(req, 'workspace.webhook_secret.rotate', ws.id);
  res.json({ ...publicWorkspace(ws, req.role), webhookSecret: secret });
}));

/** Journal d'audit de l'espace. Lecture réservée aux mainteneurs et au-dessus. */
router.get('/current/audit', auth.requireRole('MAINTAINER'), asyncRoute(async (req, res) => {
  const take = Math.min(Number(req.query.limit) || 100, 500);
  const rows = await prisma.auditLog.findMany({
    where: { workspaceId: req.workspace.id },
    orderBy: { createdAt: 'desc' },
    take,
    include: { user: { select: { id: true, name: true, email: true, avatarColor: true } } },
  });
  res.json(rows.map((r) => ({
    ...r,
    detail: r.detail ? JSON.parse(r.detail) : null,
  })));
}));

router.delete('/current', auth.requireSuperAdmin, asyncRoute(async (req, res) => {
  const confirm = String(req.query.confirm || '');
  if (confirm !== req.workspace.slug) {
    throw badRequest(
      `Suppression non confirmée. Rappelez l’identifiant de l’espace (« ${req.workspace.slug} ») ` +
      'dans le paramètre confirm.');
  }
  const ws = await prisma.workspace.findUnique({ where: { id: req.workspace.id } });
  if (!ws) throw notFound('Espace introuvable.');
  await prisma.workspace.delete({ where: { id: ws.id } });
  console.warn(`[api] espace '${ws.slug}' supprimé par ${req.user.email}`);
  res.json({ ok: true });
}));

module.exports = { router, publicWorkspace, slugify };
