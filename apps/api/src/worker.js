'use strict';
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const config = require('./config');
const prisma = require('./lib/prisma');
const secrets = require('./lib/crypto');
const keystore = require('./lib/keystore');
const { purgeExpiredSessions } = require('./lib/auth');

const active = new Map(); // buildId -> { child, containerName, workspaceId, cancelled }

const log = (...a) => console.log('[worker]', ...a);
const containerName = (id) => `apkbuild-${id.slice(0, 12)}`;

/**
 * Token de clone applicable à ce build : celui de la connexion Git du projet,
 * sinon GIT_TOKEN du .env. Retourne '' pour un dépôt public.
 */
function resolveToken(project) {
  if (project && project.provider && project.provider.tokenEnc) {
    try { return secrets.decrypt(project.provider.tokenEnc); }
    catch (e) { log(`token de la connexion '${project.provider.label}' illisible : ${e.message}`); }
  }
  return config.gitToken || '';
}

async function runBuild(build) {
  const artifactDir = path.join(config.paths.artifacts, build.id);
  const workDir = path.join(config.paths.work, build.id);
  fs.mkdirSync(artifactDir, { recursive: true });
  fs.mkdirSync(workDir, { recursive: true });

  const logPath = path.join(artifactDir, 'build.log');
  const logStream = fs.createWriteStream(logPath, { flags: 'a' });

  // Le projet est relu maintenant, pas au moment de la mise en file : une clé
  // remplacée entre-temps s'applique aux builds encore en attente.
  const project = build.projectId
    ? await prisma.project.findUnique({
      where: { id: build.projectId },
      include: { provider: true },
    })
    : null;

  // Le conteneur tourne sous l'UID du service : les fichiers déposés dans les
  // volumes montés restent la propriété de l'hôte, donc supprimables par le
  // cron de rétention sans passer par root.
  const uid = process.getuid ? process.getuid() : 0;
  const gid = process.getgid ? process.getgid() : 0;

  // Les variables passent par un fichier et non par -e : les arguments de
  // `docker run` sont visibles dans `ps` par tout utilisateur de la machine,
  // ce qui exposerait le token Git et le mot de passe du keystore. Le fichier
  // est en 0600 et disparaît avec l'espace de travail à la fin du build.
  const envFile = path.join(workDir, '.build-env');
  const envLines = [
    `BUILD_ID=${build.id}`,
    `REPO_URL=${build.repoUrl}`,
    `GIT_REF=${build.ref}`,
    `GRADLE_TASK=${build.gradleTask || config.gradleTask}`,
    `APP_SUBDIR=${build.appSubdir || config.appSubdir}`,
    `ABIS=${build.abis || config.abis}`,
  ];

  const token = resolveToken(project);
  if (token) envLines.push(`GIT_TOKEN=${token}`);

  const args = [
    'run', '--rm',
    '--name', containerName(build.id),
    '--cpus', config.buildCpus,
    '--memory', config.buildMemory,
    '--memory-swap', config.buildMemory,
    '--pids-limit', '4096',
    '--user', `${uid}:${gid}`,
    '--env-file', envFile,
    '-v', `${config.paths.cache}:/cache`,
    '-v', `${artifactDir}:/artifacts`,
    '-v', `${workDir}:/workspace`,
  ];

  // ── Signature de release, si le projet a une clé ───────────────────────────
  // Montage en lecture seule : le conteneur signe, il n'a aucune raison de
  // pouvoir réécrire la clé. Sans clé, rien n'est monté et build.sh reste sur
  // la signature debug — le retour arrière est donc immédiat.
  const ks = keystore.resolveForProject(project);
  if (ks) {
    envLines.push('KEYSTORE_FILE=/keystore/app.jks');
    envLines.push(`KEYSTORE_ALIAS=${ks.alias}`);
    envLines.push(`KEYSTORE_PASSWORD=${ks.password}`);
    args.push('-v', `${ks.path}:/keystore/app.jks:ro`);
  }

  fs.writeFileSync(envFile, envLines.join('\n') + '\n', { mode: 0o600 });
  args.push(config.dockerImage);

  logStream.write(
    `=== build ${build.id} — ${build.repoName}@${build.ref} — ${new Date().toISOString()} ===\n`);
  logStream.write(`signature : ${ks ? `clé de release (${ks.fingerprint || 'empreinte inconnue'})` : 'clé de debug'}\n`);
  logStream.write(`architectures : ${build.abis || config.abis}\n\n`);

  const name = containerName(build.id);
  const child = spawn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] });
  active.set(build.id, { child, containerName: name, workspaceId: build.workspaceId });

  child.stdout.pipe(logStream, { end: false });
  child.stderr.pipe(logStream, { end: false });

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    logStream.write(`\n!! Délai de ${config.buildTimeoutMin} min dépassé — arrêt du conteneur\n`);
    spawn('docker', ['kill', name]);
  }, config.buildTimeoutMin * 60 * 1000);

  child.on('close', async (code) => {
    clearTimeout(timer);
    const entry = active.get(build.id);
    active.delete(build.id);

    let meta = {};
    const metaPath = path.join(artifactDir, 'meta.json');
    if (fs.existsSync(metaPath)) {
      try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')); } catch { /* log seul */ }
    }

    const ok = code === 0 && meta.apk_name;
    const cancelled = entry && entry.cancelled;

    await prisma.build.update({
      where: { id: build.id },
      data: {
        status: ok ? 'success' : cancelled ? 'cancelled' : 'failed',
        apkName: meta.apk_name || null,
        apkSize: meta.apk_size || null,
        appVersion: meta.app_version || null,
        commitSha: meta.commit || build.commitSha || null,
        // Empreinte réellement apposée, relevée par apksigner dans le conteneur.
        // La consigner ici plutôt que de recopier celle du projet permet de
        // détecter une régression de signature au lieu de la masquer.
        signedWith: meta.signed_with || null,
        exitCode: code,
        error: ok ? null
          : cancelled ? 'Build interrompu depuis l’interface'
            : timedOut ? 'Délai de build dépassé'
              : `Échec du build (code ${code})`,
        finishedAt: new Date(),
      },
    }).catch((e) => log(`impossible d'enregistrer la fin de ${build.id} : ${e.message}`));

    logStream.write(`\n=== ${ok ? 'SUCCÈS' : 'ÉCHEC'} (code ${code}) — ${new Date().toISOString()} ===\n`);
    logStream.end();

    // L'espace de travail (sources, node_modules, sorties Gradle) pèse plusieurs
    // Go par build : il part immédiatement, avec le fichier d'environnement qui
    // contient le token et le mot de passe du keystore.
    fs.rm(workDir, { recursive: true, force: true }, () => {});
    log(`${build.id} -> ${ok ? 'success' : 'failed'} (${code})`);
  });

  child.on('error', async (err) => {
    clearTimeout(timer);
    active.delete(build.id);
    await prisma.build.update({
      where: { id: build.id },
      data: { status: 'failed', error: `docker: ${err.message}`, finishedAt: new Date() },
    }).catch(() => {});
    logStream.write(`\nERREUR docker: ${err.message}\n`);
    logStream.end();
    fs.rm(workDir, { recursive: true, force: true }, () => {});
  });
}

/** Interruption d'un build en cours, déclenchée depuis l'interface. */
function cancel(buildId) {
  const entry = active.get(buildId);
  if (!entry) return false;
  entry.cancelled = true;
  spawnSync('docker', ['kill', entry.containerName]);
  log(`build ${buildId} interrompu à la demande`);
  return true;
}

/**
 * Un tour de file. Deux plafonds s'appliquent : celui de la machine
 * (MAX_CONCURRENT) et celui de chaque espace. Le second empêche un client de
 * monopoliser la file au détriment des autres — sans lui, une rafale de dix
 * pushs sur un même dépôt bloquerait tout le monde.
 */
async function tick() {
  const free = config.maxConcurrent - active.size;
  if (free <= 0) return;

  const queued = await prisma.build.findMany({
    where: { status: 'queued' },
    orderBy: { createdAt: 'asc' },
    take: free * 4, // marge : certains seront écartés par le plafond d'espace
    include: { workspace: { select: { id: true, maxConcurrent: true, isActive: true } } },
  });

  const runningPerWorkspace = new Map();
  for (const e of active.values()) {
    runningPerWorkspace.set(e.workspaceId, (runningPerWorkspace.get(e.workspaceId) || 0) + 1);
  }

  let started = 0;
  for (const build of queued) {
    if (started >= free) break;
    if (!build.workspace.isActive) continue;

    const used = runningPerWorkspace.get(build.workspaceId) || 0;
    if (used >= build.workspace.maxConcurrent) continue;

    // Passage queued -> running conditionnel : deux instances du worker ne
    // peuvent pas démarrer le même build. `updateMany` renvoie le nombre de
    // lignes touchées, ce qui sert de verrou optimiste.
    const claimed = await prisma.build.updateMany({
      where: { id: build.id, status: 'queued' },
      data: { status: 'running', startedAt: new Date() },
    });
    if (claimed.count !== 1) continue;

    runningPerWorkspace.set(build.workspaceId, used + 1);
    started++;
    log(`démarrage ${build.id} — ${build.repoName}@${build.ref}`);
    runBuild(build).catch((e) => log(`démarrage impossible : ${e.message}`));
  }
}

/** Purge des artefacts au-delà de la rétention, espace par espace. */
async function purge() {
  const workspaces = await prisma.workspace.findMany({
    select: { id: true, slug: true, retentionDays: true },
  });
  for (const ws of workspaces) {
    const days = ws.retentionDays === null ? config.retentionDays : ws.retentionDays;
    if (!days || days <= 0) continue;
    const cutoff = new Date(Date.now() - days * 86400 * 1000);
    const expired = await prisma.build.findMany({
      where: { workspaceId: ws.id, createdAt: { lt: cutoff }, apkName: { not: null } },
      select: { id: true },
    });
    for (const b of expired) {
      fs.rm(path.join(config.paths.artifacts, b.id), { recursive: true, force: true }, () => {});
      await prisma.build.update({
        where: { id: b.id },
        data: { apkName: null, error: 'Artefact purgé (rétention)' },
      }).catch(() => {});
      log(`purge ${b.id} (espace ${ws.slug}, > ${days} j)`);
    }
  }
}

async function start() {
  // Un build 'running' au démarrage est un orphelin laissé par un redémarrage
  // du service : son conteneur ne lui a pas survécu.
  const orphans = await prisma.build.updateMany({
    where: { status: 'running' },
    data: {
      status: 'failed',
      error: 'Interrompu par un redémarrage du service',
      finishedAt: new Date(),
    },
  });
  if (orphans.count) log(`${orphans.count} build(s) orphelin(s) marqué(s) en échec au démarrage`);

  setInterval(() => tick().catch((e) => log(`tick: ${e.message}`)), 3000);
  setInterval(() => purge().catch((e) => log(`purge: ${e.message}`)), 6 * 3600 * 1000);
  setInterval(() => purgeExpiredSessions().catch(() => {}), 3600 * 1000);

  purge().catch((e) => log(`purge: ${e.message}`));
  tick().catch((e) => log(`tick: ${e.message}`));
  log(`démarré — ${config.maxConcurrent} build(s) en parallèle, image ${config.dockerImage}`);
}

module.exports = {
  start, cancel,
  activeCount: () => active.size,
  isActive: (id) => active.has(id),
  activeFor: (workspaceId) =>
    [...active.values()].filter((e) => e.workspaceId === workspaceId).length,
};
