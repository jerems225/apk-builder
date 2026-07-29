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
// service. Ce répertoire n'est desservi par aucune route statique : y déposer
// une clé privée sous artifacts/ la rendrait téléchargeable, sous cache/
// effaçable par le cron de purge.
//
// Les mots de passe sont passés à keytool par `-storepass:env`, jamais en
// argument : la ligne de commande d'un processus est lisible par tout compte
// de la machine, le temps que l'appel dure.

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

/** Exécute keytool avec le mot de passe dans l'environnement, pas dans argv. */
function keytool(args, password) {
  const r = spawnSync(config.keytoolBin, args, {
    encoding: 'utf8',
    timeout: 180_000, // une clé RSA 4096 prend quelques secondes, parfois plus
    env: { ...process.env, APKB_KS_PASS: password },
  });
  return { ...r, output: `${r.stdout || ''}${r.stderr || ''}` };
}

const PASS_ARGS = ['-storepass:env', 'APKB_KS_PASS', '-keypass:env', 'APKB_KS_PASS'];

/** Message lisible pour les deux causes d'échec qu'on rencontre réellement. */
function diagnostic(r, alias) {
  if (r.error) {
    return r.error.code === 'ENOENT'
      ? 'keytool est introuvable sur le serveur (paquet openjdk-17-jdk-headless).'
      : `keytool n’a pas pu être exécuté : ${r.error.message}`;
  }
  const out = r.output || '';
  if (/password was incorrect|mot de passe.*incorrect|Keystore was tampered/i.test(out)) {
    return 'Mot de passe du magasin incorrect.';
  }
  if (alias && /alias.*does not exist|n’existe pas|does not exist/i.test(out)) {
    return `L’alias « ${alias} » n’existe pas dans ce magasin.`;
  }
  return 'Fichier illisible : ce n’est pas un magasin de clés valide.';
}

/**
 * Interroge le magasin. Sert à deux choses : confirmer que le mot de passe est
 * le bon, et relever l'empreinte SHA-256 — la seule trace de la clé que
 * l'interface affichera ensuite.
 */
function inspect(file, password, alias) {
  const args = ['-list', '-v', '-keystore', file, ...PASS_ARGS];
  if (alias) args.push('-alias', alias);

  const r = keytool(args, password);
  if (r.error || r.status !== 0) return { ok: false, error: diagnostic(r, alias) };

  const out = r.output;
  const found = {
    ok: true,
    // Selon la JVM, l'étiquette est « SHA256: » ou « SHA-256: ».
    fingerprint: (out.match(/SHA-?256\s*:\s*([0-9A-F:]{95})/i) || [])[1],
    validUntil: (out.match(/(?:until|jusqu.au)\s*:\s*(.+)/i) || [])[1],
    aliases: [...out.matchAll(/(?:Alias name|Nom d.alias)\s*:\s*(.+)/gi)].map((m) => m[1].trim()),
  };
  found.alias = alias || found.aliases[0];
  if (found.alias) found.alias = String(found.alias).trim();
  if (found.validUntil) found.validUntil = String(found.validUntil).trim();
  return found;
}

// ─────────────────────────── Génération de clé ───────────────────────────────

/**
 * Échappement d'une valeur de nom distinctif. keytool traite `, + " \ < > ; =`
 * comme des séparateurs : sans échappement, une raison sociale contenant une
 * virgule produirait un DN silencieusement faux.
 */
const escapeDn = (v) => String(v || '').trim().replace(/([,+"\\<>;=])/g, '\\$1');

const ALIAS_OK = /^[A-Za-z0-9._-]{1,64}$/;

/**
 * Construit le nom distinctif du certificat. Aucun de ces champs n'est vérifié
 * par une autorité — Android n'en a pas — mais ils s'affichent dans les outils
 * d'inspection d'APK : autant qu'ils soient justes.
 */
function buildDn({ commonName, organisation, ville, pays }) {
  const cn = escapeDn(commonName);
  if (!cn) throw badRequest('Le nom de l’application (CN) est obligatoire.');
  const parts = [`CN=${cn}`];
  if (organisation) parts.push(`O=${escapeDn(organisation)}`);
  if (ville) parts.push(`L=${escapeDn(ville)}`);
  if (pays) {
    const c = String(pays).trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(c)) throw badRequest('Le pays doit être un code à deux lettres (CI, FR…).');
    parts.push(`C=${c}`);
  }
  return parts.join(', ');
}

/**
 * Génère une clé de release pour un projet, côté serveur.
 *
 * Pourquoi le serveur et non le poste de l'utilisateur : demander à chacun
 * d'installer un JDK et de composer une ligne de keytool correcte produit des
 * clés RSA 2048 à validité d'un an, des alias oubliés et des mots de passe
 * choisis à la main. Ici les paramètres sont ceux qu'on veut, à chaque fois.
 *
 * Le mot de passe est tiré au sort : personne ne le choisit, donc personne ne
 * le réutilise ailleurs.
 *
 * ⚠ L'appelant DOIT proposer le téléchargement du magasin dans la foulée. Une
 * clé qui n'existe que sur ce serveur meurt avec lui, et l'application qu'elle
 * signe ne peut alors plus jamais être mise à jour.
 */
function generate(projectId, opts) {
  const alias = String(opts.alias || '').trim();
  if (!ALIAS_OK.test(alias)) {
    throw badRequest('Alias invalide : lettres, chiffres, point, tiret et souligné, 64 caractères maximum.');
  }

  const validityDays = Number(opts.validityDays) || 10950; // ≈ 30 ans
  if (validityDays < 365 || validityDays > 36500) {
    throw badRequest('La validité doit être comprise entre 1 et 100 ans.');
  }
  const keySize = Number(opts.keySize) || 4096;
  if (![2048, 3072, 4096].includes(keySize)) {
    throw badRequest('Taille de clé admise : 2048, 3072 ou 4096 bits.');
  }

  const dn = buildDn(opts);
  const target = filePath(projectId);
  const tmp = `${target}.nouveau`;
  fs.rmSync(tmp, { force: true });

  // 32 octets d'aléa. En PKCS12, magasin et clé partagent le même mot de passe :
  // le format ne sait pas en gérer deux distincts.
  const password = secrets.randomToken(32);

  const r = keytool([
    '-genkeypair',
    '-keystore', tmp,
    '-storetype', 'PKCS12',
    '-alias', alias,
    '-keyalg', 'RSA',
    '-keysize', String(keySize),
    '-validity', String(validityDays),
    '-dname', dn,
    ...PASS_ARGS,
  ], password);

  if (r.error || r.status !== 0) {
    fs.rmSync(tmp, { force: true });
    throw badRequest(r.error
      ? diagnostic(r)
      : `keytool a refusé la génération : ${(r.output || '').split('\n').filter(Boolean).slice(-2).join(' ')}`);
  }

  // Relecture du fichier qu'on vient d'écrire : c'est ce qui garantit que
  // l'empreinte enregistrée est bien celle du magasin, et non celle qu'on
  // croit avoir demandée.
  const info = inspect(tmp, password, alias);
  if (!info.ok || !info.fingerprint) {
    fs.rmSync(tmp, { force: true });
    throw badRequest('Le magasin a été créé mais reste illisible. Génération abandonnée.');
  }

  fs.chmodSync(tmp, 0o600);
  // Renommage atomique : à aucun instant un build ne peut lire un fichier
  // à moitié écrit.
  fs.renameSync(tmp, target);

  return {
    alias,
    dn,
    validityDays,
    keySize,
    fingerprint: info.fingerprint,
    validUntil: info.validUntil || null,
    password,
    passEnc: secrets.encrypt(password),
  };
}

// ──────────────────────────── Dépôt d'un fichier ─────────────────────────────

/**
 * Enregistre un magasin existant, après validation. `buffer` est le contenu du
 * fichier déposé, jamais un chemin fourni par le client.
 */
function store(projectId, buffer, password, alias) {
  const target = filePath(projectId);
  const tmp = `${target}.upload`;

  fs.writeFileSync(tmp, buffer, { mode: 0o600 });
  try {
    const info = inspect(tmp, password, alias);
    if (!info.ok) throw badRequest(info.error);
    if (!info.fingerprint) {
      throw badRequest(
        'Magasin lu, mais aucune empreinte SHA-256 trouvée. Vérifiez que l’alias indiqué ' +
        'correspond bien à une clé du magasin.');
    }
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

// ───────────────────────────── Export et lecture ─────────────────────────────

/**
 * Contenu du magasin, pour sauvegarde hors du serveur.
 *
 * C'est le pendant indispensable de la génération côté serveur : sans export,
 * une clé générée ici n'existe qu'ici, et la perte de la machine condamne
 * définitivement les applications qu'elle signe. L'appelant est responsable de
 * n'ouvrir cette porte qu'à un propriétaire, après ré-authentification, et de
 * la tracer.
 */
function exportFile(project) {
  const file = filePath(project.id);
  if (!fs.existsSync(file)) throw badRequest('Aucun magasin de clés sur le disque pour ce projet.');
  if (!project.keystorePassEnc) throw badRequest('Mot de passe du magasin introuvable en base.');
  return {
    content: fs.readFileSync(file),
    password: secrets.decrypt(project.keystorePassEnc),
    alias: project.keystoreAlias,
    fingerprint: project.keystoreFingerprint,
  };
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

/**
 * Vrai si keytool est utilisable : l'interface n'offre la génération que si
 * elle peut aboutir. Le résultat est mémorisé — lancer un processus à chaque
 * requête pour une réponse qui ne change pas serait du gaspillage.
 */
let _available = null;
function available() {
  if (_available === null) {
    const r = spawnSync(config.keytoolBin, ['-help'], { encoding: 'utf8', timeout: 10_000 });
    _available = !r.error;
    if (!_available) {
      console.warn('[keystore] keytool introuvable — génération et dépôt de clés indisponibles ' +
        '(paquet openjdk-17-jdk-headless).');
    }
  }
  return _available;
}

module.exports = {
  dir, filePath, fileName, inspect, generate, store, exportFile, remove, exists,
  resolveForProject, available, buildDn,
};
