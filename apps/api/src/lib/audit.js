'use strict';
const prisma = require('./prisma');

/**
 * Journalise une action. Volontairement « au mieux » : une écriture d'audit qui
 * échoue ne doit pas faire échouer l'action métier déjà effectuée — sinon un
 * disque plein bloquerait tous les builds.
 *
 * `detail` est sérialisé tel quel : n'y mettre aucun secret. Les appelants ne
 * passent que des identifiants, des libellés et des empreintes.
 */
function record(req, action, target, detail) {
  const workspaceId = req.workspace ? req.workspace.id : null;
  const userId = req.user ? req.user.id : null;
  prisma.auditLog
    .create({
      data: {
        workspaceId,
        userId,
        action,
        target: target ? String(target) : null,
        detail: detail === undefined ? null : JSON.stringify(detail),
        ip: req.ip || null,
      },
    })
    .catch((e) => console.warn(`[audit] écriture impossible (${action}) — ${e.message}`));
}

module.exports = { record };
