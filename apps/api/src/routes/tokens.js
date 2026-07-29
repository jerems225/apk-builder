'use strict';
const express = require('express');
const { z } = require('zod');
const prisma = require('../lib/prisma');
const secrets = require('../lib/crypto');
const auth = require('../lib/auth');
const audit = require('../lib/audit');
const { asyncRoute, parseBody, notFound } = require('../lib/http');

const router = express.Router();
router.use(auth.requireAuth, auth.resolveWorkspace);

const publicToken = (t) => ({
  id: t.id,
  label: t.label,
  tokenHint: t.tokenHint,
  createdBy: t.createdBy ? t.createdBy.name : null,
  lastUsedAt: t.lastUsedAt,
  expiresAt: t.expiresAt,
  revokedAt: t.revokedAt,
  createdAt: t.createdAt,
});

router.get('/', auth.requireRole('MAINTAINER'), asyncRoute(async (req, res) => {
  const list = await prisma.apiToken.findMany({
    where: { workspaceId: req.workspace.id },
    orderBy: { createdAt: 'desc' },
    include: { createdBy: { select: { name: true } } },
  });
  res.json(list.map(publicToken));
}));

const schema = z.object({
  label: z.string().trim().min(1, 'Un libellé est obligatoire').max(80),
  expiresInDays: z.number().int().min(1).max(3650).nullable().optional(),
});

router.post('/', auth.requireRole('MAINTAINER'), asyncRoute(async (req, res) => {
  const body = parseBody(schema, req.body);
  // Préfixe explicite : un secret retrouvé dans un journal ou un dépôt Git se
  // reconnaît immédiatement, ce qui accélère sa révocation.
  const raw = `apkb_${secrets.randomToken(24)}`;

  const token = await prisma.apiToken.create({
    data: {
      workspaceId: req.workspace.id,
      label: body.label,
      tokenHash: secrets.sha256(raw),
      tokenHint: secrets.hint(raw),
      createdById: req.user.id,
      expiresAt: body.expiresInDays
        ? new Date(Date.now() + body.expiresInDays * 86400 * 1000)
        : null,
    },
    include: { createdBy: { select: { name: true } } },
  });

  audit.record(req, 'token.create', token.id, { label: token.label });
  // Seule occasion où le jeton complet est lisible : la base n'en garde que le
  // SHA-256, il est donc impossible de le réafficher plus tard.
  res.status(201).json({ ...publicToken(token), token: raw });
}));

router.delete('/:id', auth.requireRole('MAINTAINER'), asyncRoute(async (req, res) => {
  const token = await prisma.apiToken.findFirst({
    where: { id: req.params.id, workspaceId: req.workspace.id },
  });
  if (!token) throw notFound('Jeton introuvable dans cet espace.');

  // Révocation plutôt que suppression : la trace de l'existence du jeton et de
  // sa dernière utilisation reste consultable après coup.
  await prisma.apiToken.update({ where: { id: token.id }, data: { revokedAt: new Date() } });
  audit.record(req, 'token.revoke', token.id, { label: token.label });
  res.json({ ok: true });
}));

module.exports = router;
