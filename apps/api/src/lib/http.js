'use strict';

/**
 * Erreur porteuse d'un code HTTP. Toute erreur qui n'en est pas une devient un
 * 500 anonyme dans le gestionnaire final : un message d'exception interne ne
 * doit jamais atteindre le navigateur.
 */
class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
    this.expose = true;
  }
}

const badRequest = (m, d) => new HttpError(400, m, d);
const unauthorized = (m = 'Authentification requise') => new HttpError(401, m);
const forbidden = (m = 'Droits insuffisants pour cette action') => new HttpError(403, m);
const notFound = (m = 'Ressource introuvable') => new HttpError(404, m);
const conflict = (m, d) => new HttpError(409, m, d);
const unprocessable = (m, d) => new HttpError(422, m, d);

/**
 * Enveloppe un gestionnaire asynchrone. Sans cela, une promesse rejetée dans
 * une route Express 4 n'atteint pas le gestionnaire d'erreurs et la requête
 * reste suspendue jusqu'au timeout du client.
 */
const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/** Gestionnaire final. Placé après toutes les routes. */
function errorHandler(err, req, res, _next) {
  const status = err.status || 500;
  if (status >= 500) {
    console.error(`[api] ${req.method} ${req.path} — ${err.stack || err.message}`);
  }
  const body = { error: status >= 500 ? 'Erreur interne du service' : err.message };
  if (err.details) body.details = err.details;
  res.status(status).json(body);
}

/** Traduit une erreur Zod en 422 lisible, champ par champ. */
function parseBody(schema, body) {
  const r = schema.safeParse(body || {});
  if (r.success) return r.data;
  const details = {};
  for (const issue of r.error.issues) {
    const key = issue.path.join('.') || '_';
    if (!details[key]) details[key] = issue.message;
  }
  throw unprocessable('Les données envoyées sont incomplètes ou invalides.', details);
}

module.exports = {
  HttpError, badRequest, unauthorized, forbidden, notFound, conflict, unprocessable,
  asyncRoute, errorHandler, parseBody,
};
