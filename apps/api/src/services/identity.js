'use strict';
const prisma = require('../lib/prisma');

// Contrôles d'installabilité que le conteneur de build ne peut pas faire.
//
// build.sh vérifie que l'APK est valide : signature complète, manifeste
// lisible, architectures présentes. Cela ne suffit pas. Un APK irréprochable
// est refusé par Android dès qu'il entre en conflit avec ce qui est DÉJÀ
// installé sur le téléphone — et ce conflit ne se lit que dans l'historique
// des builds, auquel le conteneur n'a pas accès.
//
// Écrit le 30 juillet 2026 après une panne où des APK parfaitement formés
// étaient refusés sur tous les appareils : l'applicationId d'un projet était
// celui d'une autre application déjà déployée, et la clé de signature avait
// changé la veille. Les deux causes étaient invisibles côté build.

const normalizeFp = (v) => String(v || '').toUpperCase().replace(/[^0-9A-F]/g, '');

/** Empreinte abrégée, lisible dans un message : 8 premiers octets. */
const shortFp = (v) => {
  const f = normalizeFp(v);
  return f ? (f.match(/.{2}/g) || []).slice(0, 8).join(':') + '…' : '(inconnue)';
};

/**
 * Examine un build terminé au regard de l'historique du même applicationId.
 * Retourne un texte lisible (une ligne par constat) ou null si rien à signaler.
 *
 * @param {{buildId: string, projectId: string|null, repoName: string,
 *          applicationId: string|null, versionCode: string|null,
 *          signedWith: string|null}} info
 */
async function inspect(info) {
  const { buildId, projectId, applicationId, versionCode, signedWith } = info;

  // Sans applicationId, il n'y a rien à comparer : aapt2 n'a pas pu lire le
  // manifeste, et build.sh a déjà fait échouer le build dans ce cas.
  if (!applicationId) return null;

  // L'historique est relu en entier plutôt que filtré en SQL : le raisonnement
  // ci-dessous se lit d'un coup d'œil, et le volume attendu (quelques milliers
  // de builds, un applicationId à la fois) ne justifie pas plus.
  //
  // Volontairement SANS filtre d'espace : deux clients peuvent très bien
  // publier sous le même applicationId sans le savoir, et c'est précisément le
  // cas qu'il faut voir.
  const history = await prisma.build.findMany({
    where: { applicationId, status: 'success', id: { not: buildId } },
    orderBy: { finishedAt: 'desc' },
    select: {
      id: true, projectId: true, repoName: true, signedWith: true,
      versionCode: true, finishedAt: true,
      workspace: { select: { slug: true } },
    },
    take: 200,
  });

  const notes = [];

  // ── 1. Identité partagée avec un autre projet ──────────────────────────────
  // Android identifie une application par son applicationId, pas par son nom.
  // Installer la seconde par-dessus la première est vu comme une mise à jour :
  // si les clés diffèrent, l'installation est refusée ; si elles concordent,
  // l'une écrase l'autre en silence, ce qui est pire.
  const foreign = history.filter((h) => h.projectId && h.projectId !== projectId);
  if (foreign.length) {
    const seen = [...new Set(foreign.map(
      (h) => `${h.repoName}${h.workspace ? ` (espace ${h.workspace.slug})` : ''}`))];
    notes.push(
      `L'identité « ${applicationId} » est déjà utilisée par ${seen.length > 1 ? 'les projets' : 'le projet'} `
      + `${seen.slice(0, 3).join(', ')}${seen.length > 3 ? `, et ${seen.length - 3} autre(s)` : ''}. `
      + 'Deux applications ne peuvent pas coexister sous une même identité : sur un téléphone où '
      + "l'autre est installée, celle-ci sera refusée, ou l'écrasera. "
      + "Corrigez l'applicationId dans le projet Android.");
  }

  // ── 2. Changement de clé sous une identité déjà distribuée ─────────────────
  // C'est l'erreur la plus coûteuse : elle ne se manifeste que chez les
  // utilisateurs qui avaient déjà l'application, donc jamais sur un appareil
  // neuf, donc jamais pendant les tests.
  const lastSigned = history.find((h) => h.signedWith);
  if (signedWith && lastSigned && normalizeFp(lastSigned.signedWith) !== normalizeFp(signedWith)) {
    notes.push(
      `La clé de signature de « ${applicationId} » a changé : ${shortFp(lastSigned.signedWith)} `
      + `auparavant, ${shortFp(signedWith)} pour ce build. `
      + 'Android refuse toute mise à jour signée par une autre clé. Les utilisateurs qui ont déjà '
      + "l'application devront la désinstaller avant d'installer celle-ci, et ils perdront ses "
      + 'données locales.');
  }

  // ── 3. Recul du versionCode ────────────────────────────────────────────────
  // Un versionCode inférieur ou égal fait échouer l'installation par-dessus
  // l'existant, avec le même message générique que tout le reste.
  const vc = Number(versionCode);
  if (Number.isFinite(vc) && vc > 0) {
    const previous = history
      .map((h) => Number(h.versionCode))
      .filter((n) => Number.isFinite(n) && n > 0);
    const highest = previous.length ? Math.max(...previous) : null;
    if (highest !== null && vc <= highest) {
      notes.push(
        `Le versionCode de ce build (${vc}) n'est pas supérieur au plus élevé déjà publié `
        + `pour « ${applicationId} » (${highest}). Android refuse d'installer par-dessus une `
        + 'version au numéro supérieur ou égal. Incrémentez versionCode dans '
        + 'android/app/build.gradle.');
    }
  }

  return notes.length ? notes.join('\n') : null;
}

module.exports = { inspect, normalizeFp, shortFp };
