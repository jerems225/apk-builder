'use strict';
const express = require('express');
const multer = require('multer');
const { z } = require('zod');
const prisma = require('../lib/prisma');
const auth = require('../lib/auth');
const audit = require('../lib/audit');
const keystore = require('../lib/keystore');
const config = require('../config');
const { asyncRoute, parseBody, notFound, conflict, badRequest } = require('../lib/http');

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
