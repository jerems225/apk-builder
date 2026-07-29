'use strict';
const express = require('express');
const { z } = require('zod');
const prisma = require('../lib/prisma');
const passwords = require('../lib/password');
const auth = require('../lib/auth');
const audit = require('../lib/audit');
const roles = require('../lib/roles');
const { asyncRoute, parseBody, notFound, conflict, badRequest } = require('../lib/http');

const router = express.Router();
router.use(auth.requireAuth, auth.resolveWorkspace);

const publicMember = (m) => ({
  id: m.id,
  userId: m.user.id,
  name: m.user.name,
  email: m.user.email,
  avatarColor: m.user.avatarColor,
  isActive: m.user.isActive,
  isSuperAdmin: m.user.isSuperAdmin,
  lastLoginAt: m.user.lastLoginAt,
  role: m.role,
  roleLabel: roles.LABELS[m.role] || m.role,
  joinedAt: m.createdAt,
});

/** Référentiel des rôles, servi à l'interface pour éviter de le dupliquer côté front. */
router.get('/roles', (_req, res) => {
  res.json(roles.ORDER.slice().reverse().map((key) => ({
    key,
    label: roles.LABELS[key],
    description: roles.DESCRIPTIONS[key],
  })));
});

router.get('/', asyncRoute(async (req, res) => {
  const members = await prisma.membership.findMany({
    where: { workspaceId: req.workspace.id },
    include: { user: true },
    orderBy: { createdAt: 'asc' },
  });
  res.json(members.map(publicMember));
}));

const inviteSchema = z.object({
  email: z.string().trim().email('Adresse électronique invalide').max(200),
  name: z.string().trim().min(2, 'Nom trop court').max(120).optional(),
  role: z.string().refine(roles.isValid, 'Rôle inconnu').default('DEVELOPER'),
});

/**
 * Ajoute quelqu'un à l'espace.
 *
 * Pas d'envoi de courriel : le service n'a pas de relais SMTP et en ajouter un
 * pour cet usage serait disproportionné. Le mot de passe provisoire est
 * retourné une fois dans la réponse, à transmettre de vive voix ou par le canal
 * habituel de l'équipe. Le compte est marqué « mot de passe à changer ».
 */
router.post('/', auth.requireRole('OWNER'), asyncRoute(async (req, res) => {
  const body = parseBody(inviteSchema, req.body);
  const email = body.email.toLowerCase();

  if (roles.rank(body.role) > roles.rank(req.role)) {
    throw badRequest('Vous ne pouvez pas attribuer un rôle plus large que le vôtre.');
  }

  let user = await prisma.user.findUnique({ where: { email } });
  let temporaryPassword = null;

  if (!user) {
    temporaryPassword = passwords.suggest();
    user = await prisma.user.create({
      data: {
        email,
        name: body.name || email.split('@')[0],
        passwordHash: await passwords.hash(temporaryPassword),
        mustChangePassword: true,
        avatarColor: pickColor(email),
      },
    });
  }

  const already = await prisma.membership.findFirst({
    where: { userId: user.id, workspaceId: req.workspace.id },
  });
  if (already) throw conflict('Cette personne fait déjà partie de l’espace.');

  const membership = await prisma.membership.create({
    data: { userId: user.id, workspaceId: req.workspace.id, role: body.role },
    include: { user: true },
  });

  audit.record(req, 'team.add', user.id, { email, role: body.role });
  res.status(201).json({ ...publicMember(membership), temporaryPassword });
}));

const roleSchema = z.object({ role: z.string().refine(roles.isValid, 'Rôle inconnu') });

router.patch('/:membershipId', auth.requireRole('OWNER'), asyncRoute(async (req, res) => {
  const body = parseBody(roleSchema, req.body);
  const membership = await prisma.membership.findFirst({
    where: { id: req.params.membershipId, workspaceId: req.workspace.id },
    include: { user: true },
  });
  if (!membership) throw notFound('Membre introuvable dans cet espace.');

  if (roles.rank(body.role) > roles.rank(req.role)) {
    throw badRequest('Vous ne pouvez pas attribuer un rôle plus large que le vôtre.');
  }
  await guardLastOwner(req.workspace.id, membership, body.role);

  const updated = await prisma.membership.update({
    where: { id: membership.id },
    data: { role: body.role },
    include: { user: true },
  });
  audit.record(req, 'team.role', membership.userId, { role: body.role });
  res.json(publicMember(updated));
}));

router.delete('/:membershipId', auth.requireRole('OWNER'), asyncRoute(async (req, res) => {
  const membership = await prisma.membership.findFirst({
    where: { id: req.params.membershipId, workspaceId: req.workspace.id },
    include: { user: true },
  });
  if (!membership) throw notFound('Membre introuvable dans cet espace.');
  await guardLastOwner(req.workspace.id, membership, null);

  await prisma.membership.delete({ where: { id: membership.id } });
  audit.record(req, 'team.remove', membership.userId, { email: membership.user.email });
  res.json({ ok: true });
}));

/**
 * Empêche de retirer le dernier propriétaire. Sans ce garde-fou, un espace
 * devient administrable par personne et seul un accès direct à la base permet
 * de le récupérer.
 */
async function guardLastOwner(workspaceId, membership, nextRole) {
  if (membership.role !== 'OWNER') return;
  if (nextRole === 'OWNER') return;
  const owners = await prisma.membership.count({ where: { workspaceId, role: 'OWNER' } });
  if (owners <= 1) {
    throw conflict(
      'C’est le dernier propriétaire de l’espace. Nommez d’abord quelqu’un d’autre propriétaire.');
  }
}

/** Couleur d'avatar stable, dérivée de l'adresse : deux comptes voisins diffèrent. */
function pickColor(seed) {
  const palette = ['#2563eb', '#7c3aed', '#0891b2', '#059669', '#d97706', '#dc2626', '#db2777'];
  let h = 0;
  for (const c of String(seed)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return palette[h % palette.length];
}

module.exports = { router, pickColor };
