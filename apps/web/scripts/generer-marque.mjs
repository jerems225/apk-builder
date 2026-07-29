/**
 * Génère les ressources de marque de l'interface web.
 *
 *   node apps/web/scripts/generer-marque.mjs
 *
 * Produit le favicon SVG, le composant React du logo, et les icônes PNG que
 * réclame le manifeste PWA. La géométrie vit dans marque.mjs — modifier ce
 * fichier-là, jamais les fichiers produits : les chemins font plusieurs
 * milliers de caractères et ne se relisent pas.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { svg, rasteriser, png, formes } from './marque.mjs';

const ICI = dirname(fileURLToPath(import.meta.url));
const APP = join(ICI, '..', 'app');
const UI = join(ICI, '..', 'components', 'ui');
const PUBLIC = join(ICI, '..', 'public', 'marque');

mkdirSync(APP, { recursive: true });
mkdirSync(UI, { recursive: true });
mkdirSync(PUBLIC, { recursive: true });

const n2 = (v) => Math.round(v * 100) / 100;

// ── Favicon SVG ──────────────────────────────────────────────────────────────

const COMMENTAIRE = `  <!-- Produit par apps/web/scripts/generer-marque.mjs — ne pas éditer à la main.
       Le tourbillon seul : à 16 px, les nœuds du logo complet font moins d'un
       pixel et se réduisent à du bruit. Aucun aplat de fond, pour que la marque
       se pose aussi bien sur un onglet clair que sombre. -->
`;

writeFileSync(join(APP, 'icon.svg'), svg({ avecReseau: false, commentaire: COMMENTAIRE }), 'utf8');

// ── Composant React du logo ──────────────────────────────────────────────────

const corps = formes({ avecReseau: true }).map(({ couleur, points }) => {
  const d = points.map(([x, y], i) => `${i ? 'L' : 'M'}${n2(x)} ${n2(y)}`).join('') + 'Z';
  return `      <path d="${d}" fill="${couleur}"/>`;
}).join('\n');

writeFileSync(join(UI, 'logo.tsx'), `// Produit par apps/web/scripts/generer-marque.mjs — ne pas éditer à la main.
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
${corps}
    </svg>
  );
}
`, 'utf8');

// ── Icônes PNG pour le manifeste PWA ─────────────────────────────────────────
//
// Le manifeste accepte un SVG, mais Android comme Windows réclament encore des
// PNG pour l'écran d'accueil et la liste des applications. On les produit donc,
// en deux variantes :
//   - « any »      : fond transparent, la plateforme décide de l'arrière-plan ;
//   - « maskable » : fond plein et marge de 20 %, faute de quoi Android rogne
//     la marque en la découpant en cercle ou en goutte.

const TAILLES = [192, 512];
for (const taille of TAILLES) {
  writeFileSync(join(PUBLIC, `icone-${taille}.png`),
    png(rasteriser({ taille, avecReseau: taille >= 192 }), taille));

  writeFileSync(join(PUBLIC, `icone-${taille}-masquable.png`),
    png(rasteriser({ taille, avecReseau: true, fond: '#0E3A45', marge: 25 }), taille));
}

// L'icône de raccourci iOS n'accepte pas la transparence : Apple la composite
// sur du noir, ce qui rendrait la marque illisible.
writeFileSync(join(APP, 'apple-icon.png'),
  png(rasteriser({ taille: 180, avecReseau: true, fond: '#0E3A45', marge: 12 }), 180));

console.log('Écrits :');
console.log('  apps/web/app/icon.svg');
console.log('  apps/web/app/apple-icon.png');
console.log('  apps/web/components/ui/logo.tsx');
for (const t of TAILLES) {
  console.log(`  apps/web/public/marque/icone-${t}.png`);
  console.log(`  apps/web/public/marque/icone-${t}-masquable.png`);
}
