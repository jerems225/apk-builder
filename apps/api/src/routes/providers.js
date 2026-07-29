'use strict';
const express = require('express');
const { z } = require('zod');
const prisma = require('../lib/prisma');
const secrets = require('../lib/crypto');
const auth = require('../lib/auth');
const audit = require('../lib/audit');
const { asyncRoute, parseBody, notFound, badRequest } = require('../lib/http');

const router = express.Router();
router.use(auth.requireAuth, auth.resolveWorkspace);

/** Le token complet ne ressort jamais : seule son empreinte est lisible. */
const publicProvider = (p) => ({
  id: p.id,
  label: p.label,
  kind: p.kind,
  host: p.host,
  hasToken: !!p.tokenEnc,
  tokenHint: p.tokenHint,
  projectCount: p._count ? p._count.projects : undefined,
  createdAt: p.createdAt,
  updatedAt: p.updatedAt,
});

router.get('/', asyncRoute(async (req, res) => {
  const list = await prisma.provider.findMany({
    where: { workspaceId: req.workspace.id },
    orderBy: { label: 'asc' },
    include: { _count: { select: { projects: true } } },
  });
  res.json(list.map(publicProvider));
}));

const schema = z.object({
  label: z.string().trim().min(1, 'Le nom est obligatoire').max(80),
  kind: z.enum(['github', 'gitlab', 'gitea', 'generic']).default('github'),
  host: z.string().trim().min(1).max(200).default('github.com'),
  // Chaîne vide en modification = « ne pas toucher au token existant ».
  token: z.string().max(500).optional(),
});

/** Chiffre le token soumis. undefined = champ laissé vide, on conserve l'existant. */
function tokenFields(raw) {
  const t = (raw || '').trim();
  if (!t) return {};
  try {
    return { tokenEnc: secrets.encrypt(t), tokenHint: secrets.hint(t) };
  } catch (e) {
    throw badRequest(`Impossible de chiffrer le token : ${e.message}`);
  }
}

router.post('/', auth.requireRole('MAINTAINER'), asyncRoute(async (req, res) => {
  const body = parseBody(schema, req.body);
  const provider = await prisma.provider.create({
    data: {
      workspaceId: req.workspace.id,
      label: body.label,
      kind: body.kind,
      host: body.host,
      ...tokenFields(body.token),
    },
  });
  audit.record(req, 'provider.create', provider.id, { label: provider.label, kind: provider.kind });
  res.status(201).json(publicProvider(provider));
}));

router.patch('/:id', auth.requireRole('MAINTAINER'), asyncRoute(async (req, res) => {
  const current = await prisma.provider.findFirst({
    where: { id: req.params.id, workspaceId: req.workspace.id },
  });
  if (!current) throw notFound('Connexion introuvable dans cet espace.');

  const body = parseBody(schema.partial(), req.body);
  const provider = await prisma.provider.update({
    where: { id: current.id },
    data: {
      label: body.label ?? current.label,
      kind: body.kind ?? current.kind,
      host: body.host ?? current.host,
      ...tokenFields(body.token),
    },
  });
  audit.record(req, 'provider.update', provider.id, { label: provider.label });
  res.json(publicProvider(provider));
}));

router.delete('/:id', auth.requireRole('MAINTAINER'), asyncRoute(async (req, res) => {
  const current = await prisma.provider.findFirst({
    where: { id: req.params.id, workspaceId: req.workspace.id },
    include: { _count: { select: { projects: true } } },
  });
  if (!current) throw notFound('Connexion introuvable dans cet espace.');

  // Les projets liés repassent en accès public (onDelete: SetNull). On le dit
  // dans la réponse plutôt que de laisser découvrir la panne au prochain build
  // d'un dépôt privé.
  await prisma.provider.delete({ where: { id: current.id } });
  audit.record(req, 'provider.delete', current.id, {
    label: current.label, orphanedProjects: current._count.projects,
  });
  res.json({ ok: true, orphanedProjects: current._count.projects });
}));

module.exports = router;
