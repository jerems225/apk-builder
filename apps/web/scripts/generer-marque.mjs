/**
 * Génère la marque Buildex : favicon et logo d'interface.
 *
 *   node apps/web/scripts/generer-marque.mjs
 *
 * Les pales sont des bandes entre deux spirales logarithmiques, échantillonnées
 * puis écrites en chemin. Les tracer à la main en arcs de cercle donnait des
 * parts de camembert : une spirale ne s'approche pas par un arc unique.
 *
 * Deux géométries, et non une seule mise à l'échelle :
 *   - le favicon est plus trapu — cinq pales larges — parce qu'à 16 px une pale
 *     fine disparaît purement et simplement ;
 *   - la marque d'interface est plus déliée et porte le réseau de nœuds cuivre,
 *     qui ne se lit qu'au-dessus de 24 px.
 *
 * Modifier ce script, pas les fichiers produits.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ICI = dirname(fileURLToPath(import.meta.url));
const APP = join(ICI, '..', 'app');
const COMPOSANTS = join(ICI, '..', 'components', 'ui');

const C = 50;   // centre du repère
const PAS = 80; // échantillons par bord de pale

const n = (v) => Math.round(v * 100) / 100;
const pt = (th, r) => [n(C + r * Math.cos(th)), n(C + r * Math.sin(th))];

/**
 * Une pale : bande entre deux spirales, de largeur nulle aux deux extrémités.
 * Le sinus adouci affine la pale en pointe à l'extérieur comme au centre —
 * c'est précisément ce qui donne l'impression de rotation.
 */
function pale({ tours, rExt, rInt, largeur }) {
  const T = tours * 2 * Math.PI;
  const ext = [];
  const int = [];
  for (let i = 0; i <= PAS; i++) {
    const t = i / PAS;
    const th = -Math.PI / 2 + t * T;
    const r = rExt * (rInt / rExt) ** t;                    // spirale logarithmique
    const w = largeur * Math.sin(Math.PI * t) ** 0.5;
    ext.push(pt(th - w / 2, r));
    int.push(pt(th + w / 2, r));
  }
  int.reverse();
  return [...ext, ...int]
    .map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x} ${y}`)
    .join('') + 'Z';
}

const PALETTE = ['#2E9C9C', '#3E7CB1', '#7FC4C0', '#2A6E8F', '#5AAFAF', '#4A6FA5'];
const CUIVRE = '#C08457';
const COEUR = '#9FD4D0';

const rosace = (opts, couleurs) => couleurs.map((c, i) =>
  `  <path d="${pale(opts)}" fill="${c}"` +
  `${i ? ` transform="rotate(${n((360 / couleurs.length) * i)} ${C} ${C})"` : ''}/>`
).join('\n');

/** Réseau de nœuds cuivre : cinq points reliés en chaîne, comme sur le logo. */
function reseau() {
  const noeuds = [[-104, 34], [-30, 37], [40, 33], [104, 31], [170, 35]]
    .map(([deg, r]) => pt((deg * Math.PI) / 180, r));

  const liens = noeuds.slice(0, -1).map(([x1, y1], i) => {
    const [x2, y2] = noeuds[i + 1];
    return `  <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${CUIVRE}" ` +
      'stroke-width="2.2" stroke-linecap="round" opacity=".92"/>';
  }).join('\n');

  const points = noeuds
    .map(([x, y]) => `  <circle cx="${x}" cy="${y}" r="4.4" fill="${CUIVRE}"/>`)
    .join('\n');

  return `${liens}\n${points}`;
}

const OUVERTURE = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" ' +
  'role="img" aria-label="Buildex">';

const OPT_FAVICON = { tours: 0.5, rExt: 46, rInt: 13, largeur: 1.0 };
const OPT_MARQUE = { tours: 0.62, rExt: 46, rInt: 11, largeur: 0.68 };

const favicon = `${OUVERTURE}
  <!-- Produit par apps/web/scripts/generer-marque.mjs — ne pas éditer à la main.
       Le tourbillon seul : à 16 px, les nœuds du logo complet font moins d'un
       pixel et se réduisent à du bruit. Aucun aplat de fond, pour que la marque
       se pose aussi bien sur un onglet clair que sombre. -->
${rosace(OPT_FAVICON, PALETTE.slice(0, 5))}
  <circle cx="${C}" cy="${C}" r="10" fill="${COEUR}"/>
</svg>
`;

const corpsMarque = `${rosace(OPT_MARQUE, PALETTE)}
  <circle cx="${C}" cy="${C}" r="8" fill="${COEUR}"/>
${reseau()}`;

const composant = `// Produit par apps/web/scripts/generer-marque.mjs — ne pas éditer à la main.
import React from 'react';

/**
 * Marque Buildex, réseau de nœuds compris.
 *
 * Le favicon (app/icon.svg) en est une variante plus trapue : ce composant est
 * destiné à 24 px et au-delà, taille en dessous de laquelle les nœuds cuivre
 * cessent d'être lisibles.
 */
export function Logo({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" className={className}
      role="img" aria-label="Buildex">
${corpsMarque.split('\n').map((l) => (l.trim() ? '  ' + l : l)).join('\n')}
    </svg>
  );
}
`;

mkdirSync(APP, { recursive: true });
mkdirSync(COMPOSANTS, { recursive: true });
writeFileSync(join(APP, 'icon.svg'), favicon, 'utf8');
writeFileSync(join(COMPOSANTS, 'logo.tsx'), composant, 'utf8');

console.log('Écrits :');
console.log('  apps/web/app/icon.svg');
console.log('  apps/web/components/ui/logo.tsx');
