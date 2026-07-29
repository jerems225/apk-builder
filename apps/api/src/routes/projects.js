'use strict';
const express = require('express');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const { z } = require('zod');
const prisma = require('../lib/prisma');
const auth = require('../lib/auth');
const audit = require('../lib/audit');
const roles = require('../lib/roles');
const passwords = require('../lib/password');
const keystore = require('../lib/keystore');
const transfer = require('../services/transfer');
const config = require('../config');
const {
  asyncRoute, parseBody, notFound, conflict, badRequest, forbidden, unauthorized,
} = require('../lib/http');

const router = express.Router();
router.use(auth.requireAuth, auth.resolveWorkspace);

// Le fichier reste en mémoire : un magasin de clés pèse quelques kilo-octets,
// et le passer par le disque créerait un fichier temporaire en clair de plus
// à nettoyer.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 512 * 1024, files: 1 },
});

/**
 * Vue d'un projet. Le mot de passe du keystore n'apparaît nulle part : on
 * reconnaît sa clé à son empreinte, on ne la relit pas depuis un navigateur.
 */
const publicProject = (p) => ({
  id: p.id,
  name: p.name,
  repoName: p.repoName,
  repoUrl: p.repoUrl,
  providerId: p.providerId,
  provider: p.provider ? { id: p.provider.id, label: p.provider.label, kind: p.provider.kind } : null,
  appSubdir: p.appSubdir,
  gradleTask: p.gradleTask,
  branches: p.branches.split(',').map((s) => s.trim()).filter(Boolean),
  abis: p.abis.split(',').map((s) => s.trim()).filter(Boolean),
  buildTags: p.buildTags,
  enabled: p.enabled,
  signing: {
    configured: !!(p.keystoreAlias && p.keystorePassEnc),
    alias: p.keystoreAlias,
    fingerprint: p.keystoreFingerprint,
    uploadedAt: p.keystoreUploadedAt,
    fileOnDisk: keystore.exists(p.id),
  },
  buildCount: p._count ? p._count.builds : undefined,
  lastBuild: p.builds && p.builds.length ? p.builds[0] : undefined,
  createdAt: p.createdAt,
  updatedAt: p.updatedAt,
});

const ABI_VALUES = ['arm64-v8a', 'armeabi-v7a', 'x86', 'x86_64'];

const listOf = (v, fallback) => {
  const arr = Array.isArray(v) ? v : String(v ?? '').split(',');
  const clean = arr.map((s) => String(s).trim()).filter(Boolean);
  return clean.length ? clean.join(',') : fallback;
};

const schema = z.object({
  name: z.string().trim().min(1, 'Le nom est obligatoire').max(120),
  repoName: z.string().trim().regex(/^[\w.-]+\/[\w.-]+$/, 'Format attendu : organisation/depot').max(200),
  repoUrl: z.string().trim().url('URL de clone invalide')
    .refine((u) => /^https?:\/\//i.test(u), 'L’URL doit être une adresse HTTP(S) de clone.'),
  providerId: z.string().uuid().nullable().optional(),
  appSubdir: z.string().trim().max(200).default('.'),
  gradleTask: z.string().trim().max(80).default('assembleDebug'),
  branches: z.union([z.string(), z.array(z.string())]).optional(),
  abis: z.union([z.string(), z.array(z.string())]).optional(),
  buildTags: z.boolean().default(true),
  enabled: z.boolean().default(true),
});

/** Vérifie que la connexion Git citée appartient bien à l'espace courant. */
async function checkProvider(workspaceId, providerId) {
  if (!providerId) return null;
  const p = await prisma.provider.findFirst({ where: { id: providerId, workspaceId } });
  if (!p) throw badRequest('La connexion Git indiquée n’existe pas dans cet espace.');
  return p.id;
}

function normalize(body) {
  const abis = listOf(body.abis, config.abis);
  const unknown = abis.split(',').filter((a) => !ABI_VALUES.includes(a));
  if (unknown.length) {
    throw badRequest(`Architecture inconnue : ${unknown.join(', ')}. ` +
      `Valeurs admises : ${ABI_VALUES.join(', ')}.`);
  }
  return {
    appSubdir: body.appSubdir || '.',
    gradleTask: body.gradleTask || config.gradleTask,
    branches: listOf(body.branches, config.buildBranches.join(',')),
    abis,
  };
}

// ──────────────────────────────── Lecture ────────────────────────────────────

router.get('/', asyncRoute(async (req, res) => {
  const list = await prisma.project.findMany({
    where: { workspaceId: req.workspace.id },
    orderBy: { name: 'asc' },
    include: {
      provider: true,
      _count: { select: { builds: true } },
      builds: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { id: true, status: true, createdAt: true, apkSize: true, appVersion: true },
      },
    },
  });
  res.json(list.map(publicProject));
}));

router.get('/:id', asyncRoute(async (req, res) => {
  const project = await prisma.project.findFirst({
    where: { id: req.params.id, workspaceId: req.workspace.id },
    include: { provider: true, _count: { select: { builds: true } } },
  });
  if (!project) throw notFound('Projet introuvable dans cet espace.');
  res.json(publicProject(project));
}));

// ──────────────────────────────── Écriture ───────────────────────────────────

router.post('/', auth.requireRole('MAINTAINER'), asyncRoute(async (req, res) => {
  const body = parseBody(schema, req.body);
  const providerId = await checkProvider(req.workspace.id, body.providerId);

  const existing = await prisma.project.findFirst({
    where: { workspaceId: req.workspace.id, repoName: body.repoName },
  });
  if (existing) throw conflict(`Le dépôt « ${body.repoName} » est déjà enregistré dans cet espace.`);

  const project = await prisma.project.create({
    data: {
      workspaceId: req.workspace.id,
      name: body.name,
      repoName: body.repoName,
      repoUrl: body.repoUrl,
      providerId,
      buildTags: body.buildTags,
      enabled: body.enabled,
      ...normalize(body),
    },
    include: { provider: true },
  });
  audit.record(req, 'project.create', project.id, { repoName: project.repoName });
  res.status(201).json(publicProject(project));
}));

router.patch('/:id', auth.requireRole('MAINTAINER'), asyncRoute(async (req, res) => {
  const current = await prisma.project.findFirst({
    where: { id: req.params.id, workspaceId: req.workspace.id },
  });
  if (!current) throw notFound('Projet introuvable dans cet espace.');

  const body = parseBody(schema.partial(), req.body);
  if (body.providerId !== undefined) await checkProvider(req.workspace.id, body.providerId);

  if (body.repoName && body.repoName !== current.repoName) {
    const clash = await prisma.project.findFirst({
      where: { workspaceId: req.workspace.id, repoName: body.repoName },
    });
    if (clash) throw conflict(`Le dépôt « ${body.repoName} » est déjà enregistré dans cet espace.`);
  }

  const merged = { ...current, ...body };
  const project = await prisma.project.update({
    where: { id: current.id },
    data: {
      name: merged.name,
      repoName: merged.repoName,
      repoUrl: merged.repoUrl,
      providerId: body.providerId === undefined ? current.providerId : body.providerId,
      buildTags: merged.buildTags,
      enabled: merged.enabled,
      ...normalize(merged),
    },
    include: { provider: true },
  });
  audit.record(req, 'project.update', project.id, { repoName: project.repoName });
  res.json(publicProject(project));
}));

router.delete('/:id', auth.requireRole('MAINTAINER'), asyncRoute(async (req, res) => {
  const project = await prisma.project.findFirst({
    where: { id: req.params.id, workspaceId: req.workspace.id },
  });
  if (!project) throw notFound('Projet introuvable dans cet espace.');

  // La clé part avec le projet : la laisser sur disque serait un secret
  // orphelin que plus rien ne référence.
  keystore.remove(project.id);
  await prisma.project.delete({ where: { id: project.id } });

  audit.record(req, 'project.delete', project.id, { repoName: project.repoName });
  // Les builds déjà produits sont conservés (projectId passe à NULL) : les
  // liens de téléchargement déjà distribués continuent de fonctionner.
  res.json({ ok: true, buildsKept: true });
}));

// ─────────────────────── Clé de signature du projet ──────────────────────────

/**
 * Dépôt d'un magasin de clés. Le fichier est validé AVANT d'être accepté :
 * un keytool qui échoue signifie mot de passe faux ou fichier corrompu, et il
 * vaut mieux le dire ici qu'au premier build raté vingt minutes plus tard.
 */
router.post('/:id/keystore', auth.requireRole('MAINTAINER'), upload.single('keystore'),
  asyncRoute(async (req, res) => {
    const project = await prisma.project.findFirst({
      where: { id: req.params.id, workspaceId: req.workspace.id },
    });
    if (!project) throw notFound('Projet introuvable dans cet espace.');
    if (!req.file) throw badRequest('Aucun fichier reçu (champ « keystore »).');

    const alias = String(req.body.alias || '').trim();
    const password = String(req.body.password || '');
    if (!alias) throw badRequest('L’alias de la clé est obligatoire.');
    if (!password) throw badRequest('Le mot de passe du magasin est obligatoire.');

    const info = keystore.store(project.id, req.file.buffer, password, alias);

    const updated = await prisma.project.update({
      where: { id: project.id },
      data: {
        keystoreFile: keystore.fileName(project.id),
        keystoreAlias: info.alias,
        keystorePassEnc: info.passEnc,
        keystoreFingerprint: info.fingerprint,
        keystoreUploadedAt: new Date(),
      },
      include: { provider: true },
    });

    // L'empreinte est journalisée : elle n'est pas un secret, et c'est
    // précisément la trace qui permet de dater un changement de clé.
    audit.record(req, 'project.keystore.upload', project.id, {
      repoName: project.repoName, alias: info.alias, fingerprint: info.fingerprint,
    });

    res.json({
      ...publicProject(updated),
      validUntil: info.validUntil,
      avertissement:
        'Changer la clé d’une application déjà distribuée oblige les utilisateurs à la ' +
        'désinstaller puis la réinstaller. Android refuse une mise à jour signée par une ' +
        'clé différente : aucun contournement n’existe.',
    });
  }));

const transferSchema = z.object({
  targetWorkspaceId: z.string().min(1, 'Espace cible obligatoire'),
  avecBuilds: z.boolean().default(true),
});

/**
 * Déplace un projet vers un autre espace, avec ou sans son historique.
 *
 * La clé de signature suit le projet sans manipulation de fichier : le magasin
 * est rangé par identifiant de projet, qui ne change pas. La connexion Git, en
 * revanche, ne suit pas — la recopier reviendrait à dupliquer un jeton d'accès
 * dans un espace qui n'y a pas droit.
 */
router.post('/:id/transfer', auth.requireRole('OWNER'), asyncRoute(async (req, res) => {
  const body = parseBody(transferSchema, req.body);
  const r = await transfer.transfererProjet({
    user: req.user,
    source: req.workspace,
    projectId: req.params.id,
    cibleId: body.targetWorkspaceId,
    avecBuilds: body.avecBuilds,
  });

  audit.record(req, 'project.transfer.out', r.projet.id,
    { repoName: r.projet.repoName, vers: r.cible.slug, builds: r.buildsDeplaces });
  audit.record({ workspace: { id: r.cible.id }, user: req.user, ip: req.ip },
    'project.transfer.in', r.projet.id,
    { repoName: r.projet.repoName, depuis: req.workspace.slug, builds: r.buildsDeplaces });

  res.json({ ok: true, ...r });
}));

const generateSchema = z.object({
  alias: z.string().trim().min(1, 'L’alias est obligatoire').max(64),
  commonName: z.string().trim().min(1, 'Le nom de l’application est obligatoire').max(64),
  organisation: z.string().trim().max(64).optional(),
  ville: z.string().trim().max(64).optional(),
  pays: z.string().trim().length(2, 'Code pays à deux lettres').optional(),
  validityDays: z.number().int().min(365).max(36500).default(10950),
  keySize: z.union([z.literal(2048), z.literal(3072), z.literal(4096)]).default(4096),
});

/**
 * Génère la clé côté serveur.
 *
 * Le mot de passe et le magasin ne sont retournés QU'ICI. Le magasin reste
 * ensuite exportable par un propriétaire, mais le mot de passe n'est plus
 * jamais réaffiché en dehors de cet export : c'est ce qui pousse à sauvegarder
 * tout de suite.
 */
router.post('/:id/keystore/generate', auth.requireRole('MAINTAINER'),
  asyncRoute(async (req, res) => {
    const project = await prisma.project.findFirst({
      where: { id: req.params.id, workspaceId: req.workspace.id },
    });
    if (!project) throw notFound('Projet introuvable dans cet espace.');

    // Remplacer une clé existante est une décision lourde : elle appartient au
    // propriétaire, pas au mainteneur qui pose la première.
    if (project.keystoreAlias && !roles.atLeast(req.role, 'OWNER')) {
      throw forbidden(
        'Ce projet a déjà une clé de release. Son remplacement oblige tous les utilisateurs ' +
        'à réinstaller l’application : seul un propriétaire peut le décider.');
    }

    const body = parseBody(generateSchema, req.body);
    const key = keystore.generate(project.id, body);

    const updated = await prisma.project.update({
      where: { id: project.id },
      data: {
        keystoreFile: keystore.fileName(project.id),
        keystoreAlias: key.alias,
        keystorePassEnc: key.passEnc,
        keystoreFingerprint: key.fingerprint,
        keystoreUploadedAt: new Date(),
      },
      include: { provider: true },
    });

    // L'empreinte n'est pas un secret : c'est précisément la trace qui permet
    // de dater un changement de clé. Le mot de passe, lui, n'y figure pas.
    audit.record(req, 'project.keystore.generate', project.id, {
      repoName: project.repoName, alias: key.alias, fingerprint: key.fingerprint,
      dn: key.dn, keySize: key.keySize, validityDays: key.validityDays,
    });

    res.status(201).json({
      ...publicProject(updated),
      validUntil: key.validUntil,
      // Affichés une seule fois. La base ne garde le mot de passe que chiffré,
      // et l'interface ne le réaffiche jamais hors d'un export authentifié.
      motDePasse: key.password,
      magasin: {
        nom: `${project.repoName.split('/').pop()}-${key.alias}.jks`,
        contenuBase64: keystore.exportFile(updated).content.toString('base64'),
      },
      avertissement:
        'Cette clé n’existe que sur ce serveur. Téléchargez le magasin ET notez le mot de ' +
        'passe maintenant, hors de cette machine : aucune autorité ne régénère une clé ' +
        'Android, et l’application ne pourrait plus jamais être mise à jour.',
    });
  }));

// Une poignée d'essais par heure : cette route délivre une clé privée, une
// session volée ne doit pas pouvoir deviner le mot de passe du compte.
const exportLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de tentatives d’export. Réessayez dans une heure.' },
});

const exportSchema = z.object({
  password: z.string().min(1, 'Votre mot de passe est requis'),
});

/**
 * Export du magasin, pour sauvegarde hors du serveur.
 *
 * Pendant indispensable de la génération côté serveur : sans lui, une clé
 * générée ici n'existerait qu'ici. Trois garde-fous, parce qu'on distribue une
 * clé privée : rôle propriétaire, ré-authentification, et journal d'audit.
 * La ré-authentification est ce qui distingue cette route d'une session volée.
 */
router.post('/:id/keystore/export', auth.requireRole('OWNER'), exportLimiter,
  asyncRoute(async (req, res) => {
    const body = parseBody(exportSchema, req.body);
    if (!(await passwords.verify(body.password, req.user.passwordHash))) {
      console.warn(`[api] export de clé refusé pour ${req.user.email} — mot de passe incorrect`);
      throw unauthorized('Mot de passe incorrect.');
    }

    const project = await prisma.project.findFirst({
      where: { id: req.params.id, workspaceId: req.workspace.id },
    });
    if (!project) throw notFound('Projet introuvable dans cet espace.');

    const data = keystore.exportFile(project);
    audit.record(req, 'project.keystore.export', project.id, {
      repoName: project.repoName, fingerprint: data.fingerprint,
    });

    res.json({
      nom: `${project.repoName.split('/').pop()}-${data.alias}.jks`,
      contenuBase64: data.content.toString('base64'),
      alias: data.alias,
      motDePasse: data.password,
      empreinte: data.fingerprint,
    });
  }));

router.delete('/:id/keystore', auth.requireRole('OWNER'), asyncRoute(async (req, res) => {
  const project = await prisma.project.findFirst({
    where: { id: req.params.id, workspaceId: req.workspace.id },
  });
  if (!project) throw notFound('Projet introuvable dans cet espace.');

  keystore.remove(project.id);
  const updated = await prisma.project.update({
    where: { id: project.id },
    data: {
      keystoreFile: null, keystoreAlias: null, keystorePassEnc: null,
      keystoreFingerprint: null, keystoreUploadedAt: null,
    },
    include: { provider: true },
  });
  audit.record(req, 'project.keystore.delete', project.id, {
    repoName: project.repoName, fingerprint: project.keystoreFingerprint,
  });
  // Les builds suivants repartent sur la signature de debug : le retour arrière
  // est complet côté serveur. Il ne l'est pas côté utilisateur, qui a déjà
  // installé un APK signé avec la clé de release.
  res.json(publicProject(updated));
}));

module.exports = router;
