'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const config = require('../config');
const secrets = require('./crypto');
const { badRequest } = require('./http');

// Gestion des clés de signature de release, une par projet.
//
// Le fichier vit dans <root>/keystores/, en 0600, propriété du compte de
// service. Ce répertoire n'est desservi par aucune route : y déposer une clé
// privée sous artifacts/ la rendrait téléchargeable, sous cache/ effaçable par
// le cron de purge.

const dir = () => {
  fs.mkdirSync(config.paths.keystores, { recursive: true, mode: 0o700 });
  return config.paths.keystores;
};

/** Nom de fichier dérivé de l'identifiant du projet : jamais du nom fourni. */
const fileName = (projectId) => `${projectId}.jks`;

function filePath(projectId) {
  const p = path.join(dir(), fileName(projectId));
  // Ceinture et bretelles : projectId vient d'un uuid en base, mais la règle
  // « aucun chemin construit à partir d'une entrée sans vérification » vaut
  // aussi quand l'entrée paraît sûre.
  if (path.dirname(p) !== dir()) throw badRequest('Identifiant de projet invalide.');
  return p;
}

/**
 * Interroge le magasin avec keytool. Sert à deux choses au moment du dépôt :
 * confirmer que le mot de passe est le bon, et relever l'empreinte SHA-256 —
 * la seule trace de la clé que l'interface affichera ensuite.
 *
 * Retourne { ok, alias, fingerprint, validUntil, error }.
 */
function inspect(file, password, alias) {
  const args = ['-list', '-v', '-keystore', file, '-storepass', password];
  if (alias) args.push('-alias', alias);

  // Le mot de passe passe en argument de keytool, donc visible dans `ps` le
  // temps de l'appel. C'est admis ici et nulle part ailleurs : keytool n'offre
  // pas d'alternative, l'appel dure quelques millisecondes, et il n'a lieu
  // qu'au dépôt du fichier — pas à chaque build, où l'on passe par --env-file.
  const r = spawnSync(config.keytoolBin, args, { encoding: 'utf8', timeout: 20000 });

  if (r.error) {
    return {
      ok: false,
      error: r.error.code === 'ENOENT'
        ? 'keytool est introuvable sur le serveur (paquet openjdk-17-jdk-headless).'
        : `keytool n’a pas pu être exécuté : ${r.error.message}`,
    };
  }
  const out = `${r.stdout || ''}${r.stderr || ''}`;
  if (r.status !== 0) {
    // Distinguer les deux causes réelles évite un aller-retour de support.
    const wrongPass = /password was incorrect|mot de passe.*incorrect|Keystore was tampered/i.test(out);
    const noAlias = /alias.*does not exist|n’existe pas|does not exist/i.test(out);
    return {
      ok: false,
      error: wrongPass ? 'Mot de passe du magasin incorrect.'
        : noAlias ? `L’alias « ${alias} » n’existe pas dans ce magasin.`
          : 'Fichier illisible : ce n’est pas un magasin de clés valide.',
    };
  }

  const found = {
    ok: true,
    alias: alias || (out.match(/(?:Alias name|Nom d.alias)\s*:\s*(.+)/i) || [])[1],
    fingerprint: (out.match(/SHA-?256\s*:\s*([0-9A-F:]{95})/i) || [])[1],
    validUntil: (out.match(/(?:until|jusqu.au)\s*:\s*(.+)/i) || [])[1],
    aliases: [...out.matchAll(/(?:Alias name|Nom d.alias)\s*:\s*(.+)/gi)].map((m) => m[1].trim()),
  };
  if (found.alias) found.alias = String(found.alias).trim();
  if (found.validUntil) found.validUntil = String(found.validUntil).trim();
  return found;
}

/**
 * Enregistre un magasin pour un projet, après validation.
 * `buffer` est le contenu du fichier déposé, jamais un chemin fourni par le client.
 */
function store(projectId, buffer, password, alias) {
  const target = filePath(projectId);
  const tmp = `${target}.upload`;

  fs.writeFileSync(tmp, buffer, { mode: 0o600 });
  try {
    const info = inspect(tmp, password, alias);
    if (!info.ok) {
      fs.rmSync(tmp, { force: true });
      throw badRequest(info.error);
    }
    if (!info.fingerprint) {
      fs.rmSync(tmp, { force: true });
      throw badRequest(
        'Magasin lu, mais aucune empreinte SHA-256 trouvée. Vérifiez que l’alias indiqué ' +
        'correspond bien à une clé du magasin.');
    }
    // Renommage atomique : à aucun instant un build ne peut lire un fichier
    // à moitié écrit.
    fs.renameSync(tmp, target);
    fs.chmodSync(target, 0o600);
    return {
      alias: info.alias || alias,
      fingerprint: info.fingerprint,
      validUntil: info.validUntil || null,
      passEnc: secrets.encrypt(password),
    };
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    throw e;
  }
}

function remove(projectId) {
  fs.rmSync(filePath(projectId), { force: true });
}

const exists = (projectId) => fs.existsSync(filePath(projectId));

/**
 * Résout la clé applicable à un build, au moment où il démarre — et non au
 * moment de la mise en file. C'est voulu : si on remplace une clé, les builds
 * en attente doivent prendre la nouvelle.
 *
 * Retourne null si le projet n'a pas de clé : la signature debug s'applique
 * alors, comme avant, et rien ne casse.
 */
function resolveForProject(project) {
  if (!project || !project.keystoreAlias || !project.keystorePassEnc) return null;
  const file = filePath(project.id);
  if (!fs.existsSync(file)) {
    console.warn(`[keystore] projet ${project.id} : fichier absent de ${file} — signature debug`);
    return null;
  }
  try {
    return {
      path: file,
      alias: project.keystoreAlias,
      password: secrets.decrypt(project.keystorePassEnc),
      fingerprint: project.keystoreFingerprint,
    };
  } catch (e) {
    console.warn(`[keystore] projet ${project.id} : mot de passe illisible — ${e.message}`);
    return null;
  }
}

module.exports = { dir, filePath, fileName, inspect, store, remove, exists, resolveForProject };
