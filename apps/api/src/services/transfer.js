'use strict';
const prisma = require('../lib/prisma');
const roles = require('../lib/roles');
const { forbidden, notFound, conflict, badRequest } = require('../lib/http');

/**
 * Déplacement de builds et de projets d'un espace de travail vers un autre.
 *
 * L'espace est l'unité d'isolation de toute la plateforme : déplacer une ligne
 * d'un espace à l'autre est donc la seule opération qui traverse volontairement
 * cette frontière. Trois règles la tiennent :
 *
 * 1. **Propriétaire des DEUX côtés.** Exiger le rôle uniquement à la source
 *    permettrait de verser les builds d'un client dans un espace qu'on
 *    contrôle ; l'exiger uniquement à la cible permettrait d'aspirer ceux d'un
 *    espace voisin.
 * 2. **Aucune référence ne survit au passage** si elle pointe vers l'espace
 *    d'origine. Une connexion Git ou un projet resté en arrière deviendrait une
 *    fuite entre locataires, pas un simple lien cassé.
 * 3. **Rien qui tourne.** Un build en file ou en cours est réclamé par le
 *    worker avec le plafond de son espace : le déplacer sous ses pieds rendrait
 *    ce plafond faux.
 *
 * Ce qui NE bouge pas, et c'est voulu :
 * - les artefacts sur disque, rangés par identifiant de build et non par
 *   espace : les liens /dl déjà distribués continuent de fonctionner ;
 * - le magasin de clés, rangé par identifiant de projet, qui suit donc son
 *   projet sans manipulation de fichier.
 */

/** Vérifie que l'utilisateur est propriétaire de l'espace visé, et le retourne. */
async function espaceProprietaire(user, workspaceId) {
  const ws = await prisma.workspace.findFirst({
    where: { OR: [{ id: workspaceId }, { slug: workspaceId }] },
  });
  if (!ws) throw notFound('Espace de travail cible introuvable.');
  if (!ws.isActive) throw conflict(`L’espace « ${ws.name} » est désactivé.`);

  if (user.isSuperAdmin) return ws;

  const m = await prisma.membership.findFirst({
    where: { userId: user.id, workspaceId: ws.id },
  });
  if (!m || !roles.atLeast(m.role, 'OWNER')) {
    throw forbidden(
      `Un transfert demande le rôle « ${roles.LABELS.OWNER} » dans les deux espaces. ` +
      `Vous ne l’avez pas dans « ${ws.name} ».`);
  }
  return ws;
}

const TERMINES = ['success', 'failed', 'cancelled'];

/**
 * Déplace des builds. `targetProjectId` est optionnel : sans lui, les builds
 * arrivent détachés de tout projet, ce qui est licite — l'historique reste
 * consultable et téléchargeable — mais leur fait perdre le lien vers les
 * réglages et la clé.
 */
async function transfererBuilds({ user, source, cibleId, buildIds, targetProjectId }) {
  if (!Array.isArray(buildIds) || buildIds.length === 0) {
    throw badRequest('Aucun build sélectionné.');
  }
  if (buildIds.length > 500) {
    throw badRequest('500 builds au maximum par transfert, pour garder l’opération interruptible.');
  }

  const cible = await espaceProprietaire(user, cibleId);
  if (cible.id === source.id) throw badRequest('Les deux espaces sont les mêmes.');

  const builds = await prisma.build.findMany({
    where: { id: { in: buildIds }, workspaceId: source.id },
    select: { id: true, status: true, repoName: true },
  });
  if (builds.length !== buildIds.length) {
    throw notFound('Certains builds n’existent pas dans cet espace.');
  }

  const actifs = builds.filter((b) => !TERMINES.includes(b.status));
  if (actifs.length) {
    throw conflict(
      `${actifs.length} build(s) sont encore en file ou en cours. Attendez leur fin, ` +
      'ou interrompez-les avant de transférer.');
  }

  // Le projet d'accueil doit appartenir à la cible : le laisser pointer vers
  // l'espace d'origine rendrait un projet visible depuis deux locataires.
  let projet = null;
  if (targetProjectId) {
    projet = await prisma.project.findFirst({
      where: { id: targetProjectId, workspaceId: cible.id },
    });
    if (!projet) throw badRequest('Le projet d’accueil n’existe pas dans l’espace cible.');
  }

  const { count } = await prisma.build.updateMany({
    where: { id: { in: builds.map((b) => b.id) }, workspaceId: source.id },
    data: { workspaceId: cible.id, projectId: projet ? projet.id : null },
  });

  return {
    transferes: count,
    cible: { id: cible.id, name: cible.name, slug: cible.slug },
    projet: projet ? { id: projet.id, name: projet.name } : null,
    depots: [...new Set(builds.map((b) => b.repoName))],
  };
}

/**
 * Déplace un projet, avec ou sans son historique de builds.
 *
 * La connexion Git ne suit pas : elle appartient à l'espace d'origine, et la
 * recopier reviendrait à dupliquer un jeton d'accès dans un espace qui n'y a
 * pas droit. Le projet arrive donc en accès public, et l'appelant est prévenu :
 * un dépôt privé cessera d'être clonable tant qu'une connexion de l'espace
 * cible ne lui est pas rattachée.
 */
async function transfererProjet({ user, source, projectId, cibleId, avecBuilds = true }) {
  const projet = await prisma.project.findFirst({
    where: { id: projectId, workspaceId: source.id },
    include: { provider: { select: { label: true } } },
  });
  if (!projet) throw notFound('Projet introuvable dans cet espace.');

  const cible = await espaceProprietaire(user, cibleId);
  if (cible.id === source.id) throw badRequest('Les deux espaces sont les mêmes.');

  const collision = await prisma.project.findFirst({
    where: { workspaceId: cible.id, repoName: projet.repoName },
  });
  if (collision) {
    throw conflict(
      `L’espace « ${cible.name} » suit déjà le dépôt « ${projet.repoName} ». ` +
      'Renommez ou supprimez l’un des deux avant de transférer.');
  }

  const enCours = await prisma.build.count({
    where: { projectId: projet.id, status: { in: ['queued', 'running'] } },
  });
  if (enCours) {
    throw conflict(`${enCours} build(s) de ce projet sont en file ou en cours. ` +
      'Attendez leur fin avant de transférer.');
  }

  // Transaction : un projet déplacé dont les builds seraient restés en arrière
  // laisserait un projectId pointant hors de son espace.
  const [, builds] = await prisma.$transaction([
    prisma.project.update({
      where: { id: projet.id },
      data: { workspaceId: cible.id, providerId: null },
    }),
    avecBuilds
      ? prisma.build.updateMany({
        where: { projectId: projet.id },
        data: { workspaceId: cible.id },
      })
      // Sans les builds, ils restent dans l'espace d'origine mais doivent
      // perdre leur lien : sinon ils désigneraient un projet devenu étranger.
      : prisma.build.updateMany({
        where: { projectId: projet.id },
        data: { projectId: null },
      }),
  ]);

  return {
    projet: { id: projet.id, name: projet.name, repoName: projet.repoName },
    cible: { id: cible.id, name: cible.name, slug: cible.slug },
    buildsDeplaces: avecBuilds ? builds.count : 0,
    buildsDetaches: avecBuilds ? 0 : builds.count,
    connexionPerdue: projet.provider ? projet.provider.label : null,
    cleConservee: !!projet.keystoreAlias,
    avertissements: [
      projet.provider
        ? `La connexion Git « ${projet.provider.label} » n’a pas suivi : elle appartient à ` +
          'l’espace d’origine. Rattachez une connexion de l’espace cible avant le prochain ' +
          'build, sinon le clone d’un dépôt privé échouera.'
        : null,
      projet.keystoreAlias
        ? 'La clé de signature suit le projet : les mises à jour resteront installables ' +
          'par-dessus les versions déjà distribuées.'
        : null,
      'Les liens de téléchargement déjà distribués continuent de fonctionner : les artefacts ' +
      'sont rangés par identifiant de build, pas par espace.',
    ].filter(Boolean),
  };
}

module.exports = { espaceProprietaire, transfererBuilds, transfererProjet };
