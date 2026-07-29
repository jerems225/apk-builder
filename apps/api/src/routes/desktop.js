'use strict';
const fs = require('fs');
const path = require('path');
const express = require('express');
const auth = require('../lib/auth');
const audit = require('../lib/audit');
const config = require('../config');
const { asyncRoute, notFound } = require('../lib/http');

const router = express.Router();

/**
 * Distribution du client de bureau.
 *
 * Les installateurs sont déposés dans <root>/desktop/ par le processus de
 * publication — ils ne sont pas produits par ce serveur, qui n'a ni Windows ni
 * Electron. Le répertoire est simplement listé : ajouter une version consiste à
 * y copier un fichier, sans redéploiement.
 *
 * Accès réservé aux comptes de la plateforme, contrairement aux APK. Un APK est
 * destiné à des utilisateurs finaux sans compte ; ce client de bureau ne sert
 * qu'aux personnes qui ont déjà un accès, et un binaire exécutable en
 * téléchargement libre est une invitation qu'on ne tient pas à lancer.
 */

const FORMATS = [
  {
    motif: /-portable\.exe$/i,
    format: 'portable',
    libelle: 'Version portable',
    detail: 'Un seul fichier, aucune installation. Pour un poste où l’on n’installe rien.',
  },
  {
    motif: /\.exe$/i,
    format: 'exe',
    libelle: 'Installateur Windows',
    detail: 'Le choix normal. Installe pour votre compte, sans droits administrateur.',
  },
  {
    motif: /\.msi$/i,
    format: 'msi',
    libelle: 'Paquet MSI',
    detail: 'Pour un déploiement par stratégie de groupe sur un parc. Installe pour tous les comptes.',
  },
  {
    motif: /\.(dmg|zip)$/i,
    format: 'mac',
    libelle: 'macOS',
    detail: 'Image disque macOS.',
  },
  {
    motif: /\.(AppImage|deb|rpm)$/i,
    format: 'linux',
    libelle: 'Linux',
    detail: 'Paquet Linux.',
  },
];

/** Version lue dans le nom de fichier : Buildex-2.0.0-x64.exe → 2.0.0 */
const versionDe = (nom) => (nom.match(/-(\d+\.\d+\.\d+)/) || [])[1] || null;

function lister() {
  const dossier = path.join(config.root, 'desktop');
  if (!fs.existsSync(dossier)) return [];

  return fs.readdirSync(dossier)
    .filter((nom) => !nom.startsWith('.'))
    .map((nom) => {
      const complet = path.join(dossier, nom);
      const stat = fs.statSync(complet);
      if (!stat.isFile()) return null;
      const type = FORMATS.find((f) => f.motif.test(nom));
      if (!type) return null;
      return {
        nom,
        format: type.format,
        libelle: type.libelle,
        detail: type.detail,
        version: versionDe(nom),
        taille: stat.size,
        publieLe: stat.mtime,
        url: `${config.publicUrl}/api/desktop/${encodeURIComponent(nom)}`,
      };
    })
    .filter(Boolean)
    // L'installateur classique en tête : c'est ce que prendront neuf personnes
    // sur dix, et il ne doit pas se chercher.
    .sort((a, b) => FORMATS.findIndex((f) => f.format === a.format)
      - FORMATS.findIndex((f) => f.format === b.format));
}

router.use(auth.requireAuth);

router.get('/', asyncRoute(async (_req, res) => {
  const fichiers = lister();
  res.json({
    disponible: fichiers.length > 0,
    fichiers,
    // Dit à l'interface quoi afficher quand le répertoire est vide, plutôt que
    // de la laisser inventer un message.
    aide: fichiers.length ? null
      : `Aucun installateur publié. Déposez-les dans ${path.join(config.root, 'desktop')} — ` +
        'ils apparaîtront ici sans redémarrage du service.',
  });
}));

router.get('/:fichier', asyncRoute(async (req, res) => {
  const dossier = path.join(config.root, 'desktop');
  // basename() bloque toute remontée d'arborescence par le nom de fichier.
  const nom = path.basename(req.params.fichier);
  const complet = path.join(dossier, nom);

  if (!complet.startsWith(dossier) || !fs.existsSync(complet)) {
    throw notFound('Cet installateur n’existe pas sur ce serveur.');
  }
  if (!FORMATS.some((f) => f.motif.test(nom))) {
    throw notFound('Ce fichier n’est pas un installateur reconnu.');
  }

  audit.record(req, 'desktop.download', nom);
  res.set('X-Robots-Tag', 'noindex, nofollow');
  res.download(complet, nom);
}));

module.exports = router;
