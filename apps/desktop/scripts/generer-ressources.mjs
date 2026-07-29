/**
 * Produit les ressources graphiques de l'installateur et de l'application.
 *
 *   node apps/desktop/scripts/generer-ressources.mjs
 *
 * La géométrie vient de la marque du web : une seule source pour le favicon,
 * le logo d'interface et l'icône de l'exécutable. Modifier
 * apps/web/scripts/marque.mjs, jamais les fichiers produits ici.
 *
 * NSIS impose ses formats : ICO pour les icônes, BMP 24 bits sans transparence
 * pour les bandeaux. Ni PNG ni SVG ne sont acceptés — d'où les encodeurs
 * maison, sans dépendance.
 */
import { writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  rasteriser, png, ico, bmp, poser, svg,
} from '../../web/scripts/marque.mjs';

const ICI = dirname(fileURLToPath(import.meta.url));
const BUILD = join(ICI, '..', 'build');
const SRC = join(ICI, '..', 'src');
mkdirSync(BUILD, { recursive: true });

const FOND = '#0E3A45';   // teal profond, repris du logo
const CLAIR = '#F4F6F9';  // fond des bandeaux clairs de NSIS

// ── Icône de l'application et de l'installateur ──────────────────────────────
//
// Six tailles : Windows pioche celle qui lui convient selon le contexte —
// 16 dans la barre de titre, 32 dans la barre des tâches, 256 dans l'explorateur
// en grandes icônes. Une seule taille mise à l'échelle donne un résultat flou.
//
// En dessous de 48 px on tombe sur la variante trapue, sans le réseau de nœuds :
// à 16 px, un nœud cuivre fait moins d'un pixel.

const TAILLES_ICO = [16, 24, 32, 48, 64, 128, 256];
const images = TAILLES_ICO.map((taille) => ({
  taille,
  data: png(rasteriser({ taille, avecReseau: taille >= 48 }), taille),
}));
writeFileSync(join(BUILD, 'icone.ico'), ico(images));

// Icône de désinstallation : même marque, sur fond sombre pour la distinguer
// dans le Panneau de configuration.
writeFileSync(join(BUILD, 'icone-desinstallation.ico'), ico(
  TAILLES_ICO.map((taille) => ({
    taille,
    data: png(rasteriser({ taille, avecReseau: taille >= 48, fond: FOND, marge: 8 }), taille),
  })),
));

// ── Bandeau latéral de l'installateur : 164 × 314, BMP 24 bits ───────────────
//
// C'est la grande image de gauche des premières pages de l'assistant. Marque
// centrée en haut sur le teal du logo : sans texte, faute de pouvoir composer
// une police dans un rastériseur de polygones — et un texte mal crénelé ferait
// plus de mal qu'une image sobre.

function toilePleine(largeur, hauteur, couleur) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(couleur.slice(i, i + 2), 16));
  const buf = Buffer.alloc(largeur * hauteur * 4);
  for (let i = 0; i < largeur * hauteur; i++) {
    buf[i * 4] = r; buf[i * 4 + 1] = g; buf[i * 4 + 2] = b; buf[i * 4 + 3] = 255;
  }
  return buf;
}

{
  const L = 164;
  const H = 314;
  const toile = toilePleine(L, H, FOND);
  const marque = rasteriser({ taille: 108, avecReseau: true });
  poser(toile, L, marque, 108, Math.round((L - 108) / 2), 58);
  writeFileSync(join(BUILD, 'installateur-cote.bmp'), bmp(toile, L, H, FOND));
}

// ── Bandeau d'en-tête : 150 × 57, BMP 24 bits ────────────────────────────────
//
// Affiché en haut à droite des pages suivantes de l'assistant, sur le fond
// clair du thème NSIS. La marque est calée à droite, comme le veut la
// convention de ce bandeau.

{
  const L = 150;
  const H = 57;
  const toile = toilePleine(L, H, CLAIR);
  const marque = rasteriser({ taille: 45, avecReseau: true });
  poser(toile, L, marque, 45, L - 45 - 8, Math.round((H - 45) / 2));
  writeFileSync(join(BUILD, 'installateur-entete.bmp'), bmp(toile, L, H, CLAIR));
}

// ── Marque de l'écran de configuration ───────────────────────────────────────
// Chargée par configuration.html, servie depuis le disque : elle doit vivre à
// côté du HTML, pas dans build/ qui n'est pas embarqué.
writeFileSync(join(SRC, 'marque.svg'), svg({ avecReseau: true }));

console.log('Écrits :');
console.log('  apps/desktop/build/icone.ico                    (7 tailles)');
console.log('  apps/desktop/build/icone-desinstallation.ico');
console.log('  apps/desktop/build/installateur-cote.bmp        164 × 314');
console.log('  apps/desktop/build/installateur-entete.bmp      150 × 57');
console.log('  apps/desktop/src/marque.svg');
