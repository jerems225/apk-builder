'use strict';
const crypto = require('crypto');
const config = require('../config');

// AES-256-GCM : chiffrement authentifié. Le tag d'authentification garantit
// qu'un secret modifié en base est rejeté au déchiffrement au lieu de produire
// silencieusement des octets faux.
//
// PORTÉE RÉELLE DE CETTE PROTECTION : la clé maîtresse est dans
// /srv/apkbuild/.env, sur la même machine que la base. Le chiffrement protège
// contre une fuite du fichier .db ou d'une sauvegarde — pas contre un accès
// root à l'hôte, qui donnerait accès aux deux.

function masterKey() {
  const k = config.encryptionKey;
  if (!k) {
    throw new Error(
      'ENCRYPTION_KEY absente de /srv/apkbuild/.env — générez-la avec : openssl rand -hex 32');
  }
  if (!/^[0-9a-fA-F]{64}$/.test(k)) {
    throw new Error('ENCRYPTION_KEY invalide : 64 caractères hexadécimaux attendus (32 octets)');
  }
  return Buffer.from(k, 'hex');
}

/** Retourne une chaîne auto-descriptive : v1.<iv>.<tag>.<chiffré>, en base64. */
function encrypt(plaintext) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', masterKey(), iv);
  const ct = Buffer.concat([c.update(String(plaintext), 'utf8'), c.final()]);
  return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'),
    ct.toString('base64')].join('.');
}

function decrypt(blob) {
  const parts = String(blob).split('.');
  if (parts.length !== 4 || parts[0] !== 'v1') throw new Error('format de secret non reconnu');
  const [, iv, tag, ct] = parts;
  const d = crypto.createDecipheriv('aes-256-gcm', masterKey(), Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(ct, 'base64')), d.final()]).toString('utf8');
}

/**
 * Empreinte affichable d'un secret. Le secret complet ne ressort JAMAIS de la
 * base vers l'interface : l'utilisateur reconnaît son token, sans pouvoir le
 * relire depuis un navigateur.
 */
function hint(token) {
  const t = String(token || '');
  if (t.length <= 10) return '••••••';
  return `${t.slice(0, 4)}••••${t.slice(-4)}`;
}

/** Comparaison à temps constant : `===` fuit la longueur du préfixe correct. */
function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

/** Empreinte stockée en base pour sessions et jetons machine. */
const sha256 = (v) => crypto.createHash('sha256').update(String(v)).digest('hex');

/** Secret aléatoire lisible dans une URL. */
const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');

/** Vérifie au démarrage que la clé est utilisable, avant le premier secret. */
function selfTest() {
  const probe = 'verification-' + crypto.randomBytes(4).toString('hex');
  if (decrypt(encrypt(probe)) !== probe) throw new Error('auto-test de chiffrement en échec');
}

module.exports = { encrypt, decrypt, hint, safeEqual, sha256, randomToken, selfTest };
