'use strict';
const express = require('express');
const rateLimit = require('express-rate-limit');
const swaggerUi = require('swagger-ui-express');
const prisma = require('../lib/prisma');
const passwords = require('../lib/password');
const auth = require('../lib/auth');
const audit = require('../lib/audit');
const spec = require('../openapi');
const { asyncRoute } = require('../lib/http');

const router = express.Router();

// La documentation décrit précisément la surface d'attaque du service : routes,
// formats, rôles requis. Elle est donc derrière la même authentification que
// le reste, avec son propre formulaire — Swagger UI ne sait pas rediriger vers
// une page de connexion, il faut la lui servir à sa place.

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function loginPage(message) {
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Documentation de l'API — connexion</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; display: grid; place-items: center;
    font: 15px/1.55 ui-sans-serif, system-ui, "Segoe UI", Roboto, sans-serif;
    background: #f4f6fb; color: #0f172a;
  }
  .card {
    width: min(400px, calc(100vw - 2rem)); background: #fff; padding: 2rem;
    border: 1px solid #e2e8f0; border-radius: 14px;
    box-shadow: 0 12px 40px -18px rgba(15, 23, 42, .35);
  }
  h1 { margin: 0 0 .25rem; font-size: 1.15rem; }
  p.sub { margin: 0 0 1.5rem; color: #64748b; font-size: .875rem; }
  label { display: block; font-size: .8125rem; font-weight: 600; margin-bottom: .35rem; }
  input {
    width: 100%; padding: .625rem .75rem; margin-bottom: 1rem; font: inherit;
    border: 1px solid #cbd5e1; border-radius: 8px; background: #fff; color: inherit;
  }
  input:focus { outline: 2px solid #2563eb; outline-offset: 1px; border-color: #2563eb; }
  button {
    width: 100%; padding: .7rem; font: inherit; font-weight: 600; cursor: pointer;
    background: #2563eb; color: #fff; border: 0; border-radius: 8px;
  }
  button:hover { background: #1d4ed8; }
  .msg {
    background: #fef2f2; border: 1px solid #fecaca; color: #b91c1c;
    padding: .625rem .75rem; border-radius: 8px; font-size: .8125rem; margin-bottom: 1rem;
  }
  .foot { margin-top: 1.25rem; font-size: .78rem; color: #94a3b8; text-align: center; }
  @media (prefers-color-scheme: dark) {
    body { background: #0b1120; color: #e2e8f0; }
    .card { background: #111827; border-color: #1f2937; }
    input { background: #0b1120; border-color: #334155; }
    p.sub, .foot { color: #94a3b8; }
    .msg { background: #2a1215; border-color: #7f1d1d; color: #fca5a5; }
  }
</style>
</head>
<body>
  <form class="card" method="post" action="/api/docs/login">
    <h1>Documentation de l'API</h1>
    <p class="sub">Réservée aux comptes de la plateforme.</p>
    ${message ? `<div class="msg">${esc(message)}</div>` : ''}
    <label for="email">Adresse électronique</label>
    <input id="email" name="email" type="email" autocomplete="username" required autofocus>
    <label for="password">Mot de passe</label>
    <input id="password" name="password" type="password" autocomplete="current-password" required>
    <button type="submit">Ouvrir la documentation</button>
    <p class="foot">Vos identifiants sont ceux de l'interface du builder.</p>
  </form>
</body>
</html>`;
}

const docsLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Trop de tentatives. Réessayez dans quelques minutes.',
});

// Le formulaire poste en urlencoded : Swagger UI et le reste de l'API sont en
// JSON, cet analyseur est donc déclaré ici seulement.
router.post('/login', docsLimiter, express.urlencoded({ extended: false }),
  asyncRoute(async (req, res) => {
    const email = String((req.body && req.body.email) || '').trim().toLowerCase();
    const password = String((req.body && req.body.password) || '');

    const user = await prisma.user.findUnique({ where: { email } });
    const ok = user && user.isActive && (await passwords.verify(password, user.passwordHash));
    if (!ok) {
      console.warn(`[docs] échec de connexion pour '${email}' depuis ${req.ip}`);
      return res.status(401).type('html').send(loginPage('Adresse ou mot de passe incorrect.'));
    }

    const { token, expiresAt } = await auth.createSession(user, req);
    auth.setSessionCookie(res, token, expiresAt);
    req.user = user;
    audit.record(req, 'docs.login', user.id);
    res.redirect(303, '/api/docs');
  }));

/** Porte d'entrée : session valide ou formulaire. */
function gate(req, res, next) {
  if (req.user) return next();
  res.status(401).type('html').send(loginPage(null));
}

router.get('/openapi.json', gate, (_req, res) => res.json(spec));

router.use('/', gate, swaggerUi.serve, swaggerUi.setup(spec, {
  customSiteTitle: 'API du builder APK',
  swaggerOptions: {
    persistAuthorization: true,
    docExpansion: 'none',
    defaultModelsExpandDepth: 0,
    tryItOutEnabled: true,
    // La session du navigateur suffit : « Try it out » fonctionne sans coller
    // de jeton, puisque le cookie part avec la requête.
    requestInterceptor: undefined,
  },
  customCss: '.swagger-ui .topbar { display: none } .swagger-ui .info { margin: 1.5rem 0 }',
}));

module.exports = router;
