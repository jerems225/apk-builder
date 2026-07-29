'use strict';
const crypto = require('crypto');

// scrypt plutôt que bcrypt : il est dans la bibliothèque standard de Node, donc
// pas de module natif à recompiler à chaque montée de version de Node — un
// point qui a déjà coûté un déploiement sur cette machine avec better-sqlite3.
//
// Paramètres : N=2^15, r=8, p=1 (~64 Mo, ~100 ms). Coût suffisant pour un
// portail d'équipe, sans bloquer la boucle d'évènements plus que de raison
// puisque scrypt s'exécute dans le pool de threads.
const N = 32768;
const R = 8;
const P = 1;
const KEYLEN = 64;
const MAXMEM = 96 * 1024 * 1024; // scrypt refuse au-delà de 32 Mo par défaut

function hash(plain) {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16);
    crypto.scrypt(String(plain), salt, KEYLEN, { N, r: R, p: P, maxmem: MAXMEM }, (err, dk) => {
      if (err) return reject(err);
      resolve(['scrypt', N, R, P, salt.toString('base64'), dk.toString('base64')].join('$'));
    });
  });
}

function verify(plain, stored) {
  return new Promise((resolve) => {
    const parts = String(stored || '').split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return resolve(false);
    const [, n, r, p, saltB64, hashB64] = parts;
    const salt = Buffer.from(saltB64, 'base64');
    const expected = Buffer.from(hashB64, 'base64');
    crypto.scrypt(String(plain), salt, expected.length,
      { N: Number(n), r: Number(r), p: Number(p), maxmem: MAXMEM }, (err, dk) => {
        if (err) return resolve(false);
        resolve(dk.length === expected.length && crypto.timingSafeEqual(dk, expected));
      });
  });
}

/**
 * Politique de mot de passe. Volontairement courte et explicite : une règle
 * qu'on ne peut pas expliquer en une phrase est une règle qu'on contourne.
 * Retourne null si acceptable, sinon le message à afficher.
 */
function check(plain) {
  const s = String(plain || '');
  if (s.length < 10) return 'Le mot de passe doit faire au moins 10 caractères.';
  if (s.length > 200) return 'Mot de passe trop long (200 caractères maximum).';
  if (!/[a-zA-Z]/.test(s) || !/[0-9]/.test(s)) {
    return 'Le mot de passe doit contenir au moins une lettre et un chiffre.';
  }
  return null;
}

/** Proposition lisible pour la création d'un compte par un administrateur. */
function suggest() {
  const alphabet = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (const b of crypto.randomBytes(16)) out += alphabet[b % alphabet.length];
  return out;
}

module.exports = { hash, verify, check, suggest };
