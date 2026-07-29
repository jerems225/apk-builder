'use strict';

// Les rôles sont ordonnés : un OWNER peut tout ce que peut un MAINTAINER, et
// ainsi de suite. Ce classement est le seul endroit où la hiérarchie est
// définie — les routes déclarent un rôle minimum, jamais une liste de rôles.
const ORDER = ['VIEWER', 'DEVELOPER', 'MAINTAINER', 'OWNER'];

const LABELS = {
  OWNER: 'Propriétaire',
  MAINTAINER: 'Mainteneur',
  DEVELOPER: 'Développeur',
  VIEWER: 'Observateur',
};

// Ce que chaque rôle apporte de plus que le précédent, tel qu'affiché dans
// l'écran Équipe. Rédigé pour être lu par la personne à qui on attribue le
// rôle, pas par celui qui l'implémente.
const DESCRIPTIONS = {
  OWNER: 'Administre l’espace, l’équipe et les clés de signature. Peut tout supprimer.',
  MAINTAINER: 'Gère les projets, les connexions Git et les clés. Lance et annule des builds.',
  DEVELOPER: 'Lance des builds, consulte les journaux et télécharge les APK.',
  VIEWER: 'Consultation seule : builds, journaux, téléchargements.',
};

const rank = (role) => {
  const i = ORDER.indexOf(String(role || '').toUpperCase());
  return i === -1 ? -1 : i;
};

/** Vrai si `role` est au moins aussi large que `minimum`. */
const atLeast = (role, minimum) => rank(role) >= rank(minimum) && rank(role) !== -1;

const isValid = (role) => rank(role) !== -1;

module.exports = { ORDER, LABELS, DESCRIPTIONS, rank, atLeast, isValid };
