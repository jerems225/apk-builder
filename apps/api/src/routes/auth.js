'use strict';
const express = require('express');
const rateLimit = require('express-rate-limit');
const { z } = require('zod');
const prisma = require('../lib/prisma');
const passwords = require('../lib/password');
const auth = require('../lib/auth');
const audit = require('../lib/audit');
const roles = require('../lib/roles');
const { asyncRoute, parseBody, unauthorized, badRequest } = require('../lib/http');

const router = express.Router();

// Fenêtre volontairement large et plafond bas : une tentative de force brute
// sur un mot de passe scrypt est déjà lente, l'objectif ici est surtout
// d'éviter qu'elle sature le pool de threads et ralentisse les builds.
const loginLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de tentatives de connexion. Réessayez dans quelques minutes.' },
});

/** Vue publique d'un utilisateur : ni empreinte de mot de passe, ni secret. */
function publicUser(user, memberships) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    avatarColor: user.avatarColor,
    isSuperAdmin: user.isSuperAdmin,
    mustChangePassword: user.mustChangePassword,
    lastLoginAt: user.lastLoginAt,
    workspaces: (memberships || []).map((m) => ({
      id: m.workspace.id,
      name: m.workspace.name,
      slug: m.workspace.slug,
      role: m.role,
      roleLabel: roles.LABELS[m.role] || m.role,
    })),
  };
}

const loginSchema = z.object({
  email: z.string().trim().min(1, 'Adresse requise').max(200),
  password: z.string().min(1, 'Mot de passe requis').max(200),
});

router.post('/login', loginLimiter, asyncRoute(async (req, res) => {
  const body = parseBody(loginSchema, req.body);
  const user = await prisma.user.findUnique({
    where: { email: body.email.toLowerCase() },
    include: { memberships: { include: { workspace: true } } },
  });

  // Message identique dans les deux cas : distinguer « compte inconnu » de
  // « mot de passe faux » indique à un attaquant quelles adresses existent.
  const ok = user && user.isActive && (await passwords.verify(body.password, user.passwordHash));
  if (!ok) {
    console.warn(`[auth] échec de connexion pour '${body.email}' depuis ${req.ip}`);
    throw unauthorized('Adresse ou mot de passe incorrect.');
  }

  const { token, expiresAt } = await auth.createSession(user, req);
  auth.setSessionCookie(res, token, expiresAt);
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

  req.user = user;
  audit.record(req, 'auth.login', user.id);
  res.json({ user: publicUser(user, user.memberships), expiresAt });
}));

router.post('/logout', asyncRoute(async (req, res) => {
  await auth.destroySession(req.sessionToken);
  auth.clearSessionCookie(res);
  if (req.user) audit.record(req, 'auth.logout', req.user.id);
  res.json({ ok: true });
}));

router.get('/me', auth.requireAuth, asyncRoute(async (req, res) => {
  res.json({ user: publicUser(req.user, req.user.memberships) });
}));

const passwordSchema = z.object({
  currentPassword: z.string().min(1, 'Mot de passe actuel requis'),
  newPassword: z.string().min(1, 'Nouveau mot de passe requis'),
});

router.post('/password', auth.requireAuth, asyncRoute(async (req, res) => {
  const body = parseBody(passwordSchema, req.body);
  if (!(await passwords.verify(body.currentPassword, req.user.passwordHash))) {
    throw unauthorized('Mot de passe actuel incorrect.');
  }
  const problem = passwords.check(body.newPassword);
  if (problem) throw badRequest(problem);

  await prisma.user.update({
    where: { id: req.user.id },
    data: { passwordHash: await passwords.hash(body.newPassword), mustChangePassword: false },
  });

  // Toutes les autres sessions tombent : c'est le comportement attendu d'un
  // changement de mot de passe, et le seul moyen de reprendre la main si le
  // compte a été utilisé ailleurs.
  await prisma.session.deleteMany({
    where: { userId: req.user.id, NOT: { id: req.session.id } },
  });

  audit.record(req, 'auth.password.change', req.user.id);
  res.json({ ok: true });
}));

/** Sessions ouvertes du compte, pour que l'utilisateur puisse les révoquer. */
router.get('/sessions', auth.requireAuth, asyncRoute(async (req, res) => {
  const list = await prisma.session.findMany({
    where: { userId: req.user.id, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
    select: { id: true, userAgent: true, ip: true, createdAt: true, expiresAt: true },
  });
  res.json(list.map((s) => ({ ...s, current: s.id === req.session.id })));
}));

router.delete('/sessions/:id', auth.requireAuth, asyncRoute(async (req, res) => {
  await prisma.session.deleteMany({ where: { id: req.params.id, userId: req.user.id } });
  audit.record(req, 'auth.session.revoke', req.params.id);
  res.json({ ok: true });
}));

module.exports = { router, publicUser };
