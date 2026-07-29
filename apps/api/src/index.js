'use strict';
const fs = require('fs');
const express = require('express');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const helmet = require('helmet');

const config = require('./config');
const secrets = require('./lib/crypto');
const auth = require('./lib/auth');
const worker = require('./worker');
const { errorHandler } = require('./lib/http');

const authRoutes = require('./routes/auth');
const workspaceRoutes = require('./routes/workspaces');
const projectRoutes = require('./routes/projects');
const providerRoutes = require('./routes/providers');
const buildRoutes = require('./routes/builds');
const teamRoutes = require('./routes/team');
const tokenRoutes = require('./routes/tokens');
const statsRoutes = require('./routes/stats');
const webhookRoutes = require('./routes/webhooks');
const downloadRoutes = require('./routes/downloads');
const docsRoutes = require('./routes/docs');

// Les répertoires sont créés au démarrage : un service qui échoue au premier
// build parce qu'un dossier manque coûte plus cher à diagnostiquer que ces
// quatre lignes.
for (const dir of [config.paths.artifacts, config.paths.work, config.paths.cache,
  config.paths.data, config.paths.uploads]) {
  fs.mkdirSync(dir, { recursive: true });
}
fs.mkdirSync(config.paths.cache + '/home', { recursive: true });
// 0700 sur les clés : seul le compte de service y accède.
fs.mkdirSync(config.paths.keystores, { recursive: true, mode: 0o700 });

// Le chiffrement est vérifié au démarrage plutôt qu'au premier secret saisi :
// mieux vaut une ligne de journal explicite qu'une erreur au moment où
// quelqu'un enregistre une connexion Git.
let cryptoReady = false;
try { secrets.selfTest(); cryptoReady = true; }
catch (e) { console.warn(`[api] chiffrement indisponible — ${e.message}`); }

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1); // Apache en frontal

app.use(helmet({
  // Swagger UI a besoin de styles et de scripts en ligne ; le reste de l'API
  // ne sert pas de HTML, donc la politique par défaut serait inutilement
  // contraignante ici.
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  // Le front est sur une autre origine et télécharge les APK : une politique
  // same-origin bloquerait les requêtes légitimes du tableau de bord.
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

// Le front tourne sur une autre origine (Next.js) et envoie le cookie de
// session : l'origine doit être explicitement listée, un '*' est incompatible
// avec credentials.
app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true); // curl, webhooks, requêtes serveur à serveur
    const allowed = [config.webOrigin, config.publicUrl];
    cb(null, allowed.includes(origin.replace(/\/+$/, '')));
  },
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Workspace'],
}));

// Le corps brut est indispensable au calcul HMAC des webhooks : le JSON
// re-sérialisé ne redonne pas les mêmes octets que ceux signés par GitHub. Il
// est capturé sur les DEUX analyseurs — un webhook réglé sur
// « x-www-form-urlencoded » n'est pas traité par express.json, et le corps brut
// serait alors vide.
const keepRaw = (req, _res, buf) => { req.rawBody = buf; };
app.use(express.json({ limit: '2mb', verify: keepRaw }));
app.use(express.urlencoded({ extended: false, limit: '2mb', verify: keepRaw }));
app.use(cookieParser());
app.use(auth.attachUser);

// ───────────────────────────── Routes publiques ──────────────────────────────

app.get('/healthz', (_req, res) => res.json({
  ok: true,
  running: worker.activeCount(),
  limit: config.maxConcurrent,
  crypto: cryptoReady,
}));

app.use('/api/webhooks', webhookRoutes.router);
app.post('/webhook', webhookRoutes.legacy); // ancienne route, à retirer une fois migrée
app.use('/', downloadRoutes);

// ──────────────────────────── Routes authentifiées ───────────────────────────

app.use('/api/auth', authRoutes.router);
app.use('/api/workspaces', workspaceRoutes.router);
app.use('/api/projects', projectRoutes);
app.use('/api/providers', providerRoutes);
app.use('/api/builds', buildRoutes.router);
app.use('/api/team', teamRoutes.router);
app.use('/api/tokens', tokenRoutes);
app.use('/api/stats', statsRoutes);
app.use('/api/docs', docsRoutes);

// Déclenchement machine : même contrôleur que POST /api/builds, mais
// authentifié par jeton porteur. La route est distincte pour que le middleware
// d'authentification le soit aussi — mélanger les deux dans une même route
// rendrait les erreurs d'authentification ambiguës.
app.post('/api/ci/builds', auth.requireApiToken, buildRoutes.createBuild);

app.use((_req, res) => res.status(404).json({ error: 'Route inconnue' }));
app.use(errorHandler);

// ────────────────────────────────── Démarrage ────────────────────────────────

const server = app.listen(config.port, config.bindHost, async () => {
  console.log(`[api] écoute sur ${config.bindHost}:${config.port} — public : ${config.publicUrl}`);
  console.log(`[api] front autorisé en CORS : ${config.webOrigin}`);
  console.log(`[api] chiffrement des secrets : ${cryptoReady ? 'actif' : 'INDISPONIBLE'}`);
  console.log(`[api] documentation : ${config.publicUrl}/api/docs`);
  if (!cryptoReady) {
    console.warn('[api] ATTENTION : sans ENCRYPTION_KEY, aucun token ni mot de passe de ' +
      'keystore ne peut être enregistré.');
  }
  await worker.start();
});

// Arrêt propre : systemd envoie SIGTERM au redémarrage. Sans cela, les
// connexions en cours sont coupées net et le navigateur affiche une erreur
// réseau au lieu d'un simple rechargement.
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    console.log(`[api] ${sig} reçu — arrêt`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 10_000).unref();
  });
}
