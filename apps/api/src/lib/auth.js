'use strict';
const prisma = require('./prisma');
const secrets = require('./crypto');
const roles = require('./roles');
const config = require('../config');
const { unauthorized, forbidden, notFound } = require('./http');

// ─────────────────────────────── Sessions ────────────────────────────────────

/**
 * Ouvre une session. Le secret complet n'est retourné qu'ici, pour être posé
 * dans le cookie ; la base n'en garde que le SHA-256. Un accès en lecture à la
 * base ne permet donc pas d'usurper une session ouverte.
 */
async function createSession(user, req) {
  const token = secrets.randomToken(32);
  const expiresAt = new Date(Date.now() + config.sessionHours * 3600 * 1000);
  await prisma.session.create({
    data: {
      tokenHash: secrets.sha256(token),
      userId: user.id,
      userAgent: (req.get('user-agent') || '').slice(0, 250) || null,
      ip: req.ip || null,
      expiresAt,
    },
  });
  return { token, expiresAt };
}

function setSessionCookie(res, token, expiresAt) {
  res.cookie(config.cookieName, token, {
    httpOnly: true, // inaccessible au JavaScript de page : un XSS ne vole pas la session
    sameSite: 'lax', // suffit à bloquer le CSRF sur les requêtes cross-site
    secure: config.cookieSecure,
    path: '/',
    expires: expiresAt,
  });
}

const clearSessionCookie = (res) =>
  res.clearCookie(config.cookieName, { path: '/', sameSite: 'lax', secure: config.cookieSecure });

async function destroySession(token) {
  if (!token) return;
  await prisma.session
    .deleteMany({ where: { tokenHash: secrets.sha256(token) } })
    .catch(() => {});
}

/** Ménage périodique : une session expirée reste en base tant qu'on ne la purge pas. */
async function purgeExpiredSessions() {
  const { count } = await prisma.session.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  return count;
}

// ───────────────────────────── Middlewares ───────────────────────────────────

/**
 * Résout la session sans exiger qu'elle existe. Utilisé par les routes qui
 * changent d'affichage selon l'état de connexion (la page Swagger notamment).
 */
async function attachUser(req, _res, next) {
  const token = req.cookies ? req.cookies[config.cookieName] : null;
  if (!token) return next();
  try {
    const session = await prisma.session.findUnique({
      where: { tokenHash: secrets.sha256(token) },
      include: { user: { include: { memberships: { include: { workspace: true } } } } },
    });
    if (!session || session.expiresAt < new Date() || !session.user.isActive) return next();
    req.session = session;
    req.sessionToken = token;
    req.user = session.user;
  } catch (e) {
    console.warn(`[auth] session illisible — ${e.message}`);
  }
  next();
}

function requireAuth(req, _res, next) {
  if (!req.user) return next(unauthorized());
  next();
}

/**
 * Résout l'espace de travail courant et le rôle de l'utilisateur dedans.
 *
 * Ordre de résolution : en-tête X-Workspace (le front l'envoie explicitement),
 * puis paramètre de requête, puis dernier espace sélectionné en session, puis
 * premier espace de l'utilisateur. Le repli garantit qu'un utilisateur
 * fraîchement connecté voit quelque chose sans avoir à choisir.
 */
async function resolveWorkspace(req, _res, next) {
  if (!req.user) return next(unauthorized());

  const wanted =
    req.get('x-workspace') ||
    (req.query && req.query.workspace) ||
    (req.session && req.session.currentWorkspaceId) ||
    null;

  const memberships = req.user.memberships || [];

  let membership = null;
  if (wanted) {
    membership = memberships.find((m) => m.workspaceId === wanted || m.workspace.slug === wanted);
  }
  if (!membership) membership = memberships[0];

  // Un super-administrateur peut inspecter un espace dont il n'est pas membre :
  // c'est le rôle d'exploitation. L'action reste tracée dans le journal d'audit.
  if (!membership && req.user.isSuperAdmin && wanted) {
    const ws = await prisma.workspace.findFirst({
      where: { OR: [{ id: wanted }, { slug: wanted }] },
    });
    if (ws) {
      req.workspace = ws;
      req.role = 'OWNER';
      req.isImpersonatedAccess = true;
      return next();
    }
  }

  if (!membership) {
    return next(notFound('Aucun espace de travail accessible avec ce compte.'));
  }

  req.workspace = membership.workspace;
  req.role = req.user.isSuperAdmin ? 'OWNER' : membership.role;

  // Mémorise le choix pour la prochaine requête, sans attendre l'écriture :
  // c'est un confort d'affichage, pas une donnée critique.
  if (req.session && req.session.currentWorkspaceId !== req.workspace.id) {
    prisma.session
      .update({ where: { id: req.session.id }, data: { currentWorkspaceId: req.workspace.id } })
      .catch(() => {});
  }
  next();
}

/** Exige un rôle minimum dans l'espace courant. */
const requireRole = (minimum) => (req, _res, next) => {
  if (!req.role) return next(unauthorized());
  if (!roles.atLeast(req.role, minimum)) {
    return next(forbidden(
      `Cette action demande le rôle « ${roles.LABELS[minimum]} » ou supérieur. ` +
      `Le vôtre est « ${roles.LABELS[req.role] || req.role} ».`));
  }
  next();
};

const requireSuperAdmin = (req, _res, next) => {
  if (!req.user || !req.user.isSuperAdmin) {
    return next(forbidden('Réservé à l’administration de la plateforme.'));
  }
  next();
};

/**
 * Authentification machine par jeton porteur, pour les CI tierces.
 * Le jeton porte son espace : il n'y a pas de sélection possible, donc pas de
 * risque de déclencher un build chez un autre client.
 */
async function requireApiToken(req, _res, next) {
  const raw = (req.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!raw) return next(unauthorized('Jeton API absent (en-tête Authorization: Bearer …).'));

  const token = await prisma.apiToken.findUnique({
    where: { tokenHash: secrets.sha256(raw) },
    include: { workspace: true },
  });
  if (!token || token.revokedAt || (token.expiresAt && token.expiresAt < new Date())) {
    return next(unauthorized('Jeton API invalide, révoqué ou expiré.'));
  }
  if (!token.workspace.isActive) return next(forbidden('Espace de travail désactivé.'));

  req.apiToken = token;
  req.workspace = token.workspace;
  req.role = 'DEVELOPER'; // un jeton machine déclenche des builds, il n'administre pas

  prisma.apiToken
    .update({ where: { id: token.id }, data: { lastUsedAt: new Date() } })
    .catch(() => {});
  next();
}

module.exports = {
  createSession, setSessionCookie, clearSessionCookie, destroySession, purgeExpiredSessions,
  attachUser, requireAuth, resolveWorkspace, requireRole, requireSuperAdmin, requireApiToken,
};
