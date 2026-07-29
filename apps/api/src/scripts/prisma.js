'use strict';
/**
 * Enveloppe de la CLI Prisma.
 *
 * Pourquoi elle existe : la CLI lit `DATABASE_URL` dans l'environnement et
 * n'exécute pas le code de l'application. Or cette variable n'est écrite nulle
 * part — `config.js` la dérive de `APKBUILD_ROOT` au démarrage du service.
 * Appeler `prisma db push` directement échoue donc avec « Environment variable
 * not found: DATABASE_URL », alors que le service, lui, démarre correctement.
 *
 * Charger `config.js` d'abord résout le problème une fois pour toutes, et sans
 * dupliquer la règle de dérivation : le chemin de la base reste défini à un
 * seul endroit.
 *
 *   node src/scripts/prisma.js db push
 *   node src/scripts/prisma.js generate
 */
const path = require('path');
const { spawnSync } = require('child_process');

// L'effet de bord est voulu : config.js lit /srv/apkbuild/.env puis pose
// process.env.DATABASE_URL si elle est absente.
const config = require('../config');

const args = process.argv.slice(2);
if (!args.length) {
  console.error('Usage : node src/scripts/prisma.js <commande prisma…>');
  process.exit(2);
}

// Résolution par require.resolve plutôt que par un chemin en dur : dans un
// monorepo npm workspaces, la CLI est remontée à la racine, pas dans apps/api.
let cli;
try {
  const pkgPath = require.resolve('prisma/package.json');
  const pkg = require(pkgPath);
  const rel = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin.prisma;
  cli = path.join(path.dirname(pkgPath), rel);
} catch (e) {
  console.error('La CLI Prisma est introuvable. Lancez d’abord : npm install');
  process.exit(1);
}

console.log(`[prisma] base : ${process.env.DATABASE_URL}`);
if (!config.encryptionKey) {
  console.warn('[prisma] ENCRYPTION_KEY absente — sans effet ici, mais le service ' +
    'ne pourra enregistrer aucun secret.');
}

const r = spawnSync(process.execPath, [cli, ...args], {
  stdio: 'inherit',
  // La CLI cherche prisma/schema.prisma relativement au répertoire courant :
  // on se place dans apps/api quel que soit l'endroit d'où le script est lancé.
  cwd: path.join(__dirname, '..', '..'),
  env: process.env,
});

process.exit(r.status === null ? 1 : r.status);
