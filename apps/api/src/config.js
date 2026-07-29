'use strict';
const path = require('path');
const fs = require('fs');

// Chargement d'un .env minimaliste : évite une dépendance de plus pour
// quatre lignes de parsing, et garde le fichier lisible par un humain.
function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}

const ROOT = process.env.APKBUILD_ROOT || '/srv/apkbuild';
loadEnvFile(path.join(ROOT, '.env'));
// Repli développement : un .env à la racine du dépôt quand on travaille en local.
loadEnvFile(path.join(__dirname, '..', '..', '..', '.env'));

const num = (v, d) => (v === undefined || v === '' || isNaN(Number(v)) ? d : Number(v));
const list = (v, d) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : d);
const bool = (v, d) => (v === undefined || v === '' ? d : v !== 'false' && v !== '0');

const paths = {
  root: ROOT,
  artifacts: path.join(ROOT, 'artifacts'),
  work: path.join(ROOT, 'work'),
  cache: path.join(ROOT, 'cache'),
  data: path.join(ROOT, 'data'),
  // Répertoire des clés de signature. Volontairement hors de artifacts/ (servi
  // publiquement par /dl) et hors de cache/ (purgeable) : y déposer une clé
  // privée la rendrait téléchargeable ou effaçable.
  keystores: path.join(ROOT, 'keystores'),
  uploads: path.join(ROOT, 'uploads'),
};

// Prisma lit DATABASE_URL et rien d'autre. On la dérive du ROOT quand elle
// n'est pas fournie, pour qu'un déploiement standard n'ait rien à régler.
//
// Attention : la CLI Prisma (`prisma db push`, `prisma generate`) n'exécute pas
// ce fichier. Les commandes npm passent donc par src/scripts/prisma.js, qui le
// charge d'abord. Un appel direct à `npx prisma …` échouerait sur
// « Environment variable not found: DATABASE_URL ».
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = `file:${path.join(paths.data, 'apkbuild.db')}`;
}

module.exports = {
  root: ROOT,
  paths,

  env: process.env.NODE_ENV || 'production',
  port: num(process.env.PORT, 9100),
  bindHost: process.env.BIND_HOST || '127.0.0.1',
  publicUrl: (process.env.PUBLIC_URL || 'http://localhost:9100').replace(/\/+$/, ''),
  // Origine du front Next.js, autorisée en CORS avec cookies.
  webOrigin: (process.env.WEB_ORIGIN || 'http://localhost:3000').replace(/\/+$/, ''),

  // Clé maîtresse (32 octets hexadécimaux) protégeant tokens Git, secrets de
  // webhook et mots de passe de keystore. Sa perte rend ces secrets illisibles :
  // il faut alors les ressaisir dans l'interface.
  encryptionKey: process.env.ENCRYPTION_KEY || '',

  // Durée de vie d'une session d'interface, en heures.
  sessionHours: num(process.env.SESSION_HOURS, 12),
  cookieName: process.env.COOKIE_NAME || 'apkb_session',
  cookieSecure: bool(process.env.COOKIE_SECURE, (process.env.PUBLIC_URL || '').startsWith('https')),

  // Compte créé au premier démarrage si la base est vide.
  bootstrapEmail: process.env.BOOTSTRAP_EMAIL || 'admin@local',
  bootstrapPassword: process.env.BOOTSTRAP_PASSWORD || '',
  bootstrapWorkspace: process.env.BOOTSTRAP_WORKSPACE || 'Atelier',

  // Secret de repli pour l'ancienne route /webhook, conservée le temps que les
  // hooks déjà posés migrent vers /api/webhooks/<espace>.
  legacyWebhookSecret: process.env.WEBHOOK_SECRET || '',
  legacyWorkspaceSlug: process.env.LEGACY_WORKSPACE_SLUG || '',

  // Token Git de repli, utilisé quand le projet n'a pas de connexion associée.
  gitToken: process.env.GIT_TOKEN || '',

  // Politique de build par défaut, surchargée projet par projet.
  buildBranches: list(process.env.BUILD_BRANCHES, ['main', 'master', 'develop']),
  buildTags: bool(process.env.BUILD_TAGS, true),
  gradleTask: process.env.GRADLE_TASK || 'assembleDebug',
  appSubdir: process.env.APP_SUBDIR || '.',
  abis: process.env.ABIS || 'arm64-v8a',

  // Exécution. maxConcurrent est un plafond machine : la somme des plafonds
  // d'espaces peut le dépasser, c'est celui-ci qui tranche.
  dockerImage: process.env.DOCKER_IMAGE || 'rn-android-builder:1',
  maxConcurrent: num(process.env.MAX_CONCURRENT, 2),
  buildCpus: process.env.BUILD_CPUS || '3',
  buildMemory: process.env.BUILD_MEMORY || '8g',
  buildTimeoutMin: num(process.env.BUILD_TIMEOUT_MIN, 45),

  retentionDays: num(process.env.RETENTION_DAYS, 30),

  // Chemin du keytool, utilisé pour valider un keystore déposé dans
  // l'interface. Vide = on cherche dans le PATH.
  keytoolBin: process.env.KEYTOOL_BIN || 'keytool',
};
