/**
 * Géométrie de la marque Buildex, et de quoi la produire en SVG comme en
 * pixels.
 *
 * Pourquoi un rastériseur maison plutôt qu'une bibliothèque : les seuls
 * consommateurs sont trois scripts de génération, lancés à la main quand la
 * marque change. Ajouter `sharp` ou `canvas` — deux modules natifs à
 * recompiler à chaque montée de version de Node — coûterait plus cher en
 * maintenance que ces deux cents lignes, pour dessiner des polygones pleins.
 *
 * La chaîne est volontairement sans dépendance : polygones → tampon RGBA →
 * PNG (zlib de Node) ou BMP (aucune compression). L'ICO enveloppe les PNG,
 * ce que Windows accepte depuis Vista.
 */
import { deflateSync } from 'node:zlib';

// ─────────────────────────────── Géométrie ───────────────────────────────────

const C = 50;   // centre, dans un repère 0-100
const PAS = 80; // échantillons par bord de pale

export const PALETTE = ['#2E9C9C', '#3E7CB1', '#7FC4C0', '#2A6E8F', '#5AAFAF', '#4A6FA5'];
export const CUIVRE = '#C08457';
export const COEUR = '#9FD4D0';

export const OPT_FAVICON = { tours: 0.5, rExt: 46, rInt: 13, largeur: 1.0 };
export const OPT_MARQUE = { tours: 0.62, rExt: 46, rInt: 11, largeur: 0.68 };

const n2 = (v) => Math.round(v * 100) / 100;

/**
 * Sommets d'une pale : bande entre deux spirales logarithmiques, de largeur
 * nulle aux deux extrémités.
 *
 * Le sinus adouci affine la pale en pointe à l'extérieur comme au centre —
 * c'est précisément ce qui donne l'impression de rotation. Une première
 * version en arcs de cercle donnait des parts de camembert : une spirale ne
 * s'approche pas par un arc unique.
 */
export function paleSommets({ tours, rExt, rInt, largeur }, rotationDeg = 0) {
  const T = tours * 2 * Math.PI;
  const rot = (rotationDeg * Math.PI) / 180;
  const ext = [];
  const int = [];
  for (let i = 0; i <= PAS; i++) {
    const t = i / PAS;
    const th = -Math.PI / 2 + t * T + rot;
    const r = rExt * (rInt / rExt) ** t;
    const w = largeur * Math.sin(Math.PI * t) ** 0.5;
    ext.push([C + r * Math.cos(th - w / 2), C + r * Math.sin(th - w / 2)]);
    int.push([C + r * Math.cos(th + w / 2), C + r * Math.sin(th + w / 2)]);
  }
  int.reverse();
  return [...ext, ...int];
}

/** Cercle approché par un polygone : le rastériseur ne connaît que des polygones. */
export function cercleSommets(cx, cy, r, cotes = 64) {
  return Array.from({ length: cotes }, (_, i) => {
    const a = (i / cotes) * 2 * Math.PI;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  });
}

/** Segment épais, rendu comme un rectangle à bouts carrés. */
export function segmentSommets([x1, y1], [x2, y2], epaisseur) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const l = Math.hypot(dx, dy) || 1;
  const nx = (-dy / l) * (epaisseur / 2);
  const ny = (dx / l) * (epaisseur / 2);
  return [[x1 + nx, y1 + ny], [x2 + nx, y2 + ny], [x2 - nx, y2 - ny], [x1 - nx, y1 - ny]];
}

export const polaire = (deg, r) => [
  C + r * Math.cos((deg * Math.PI) / 180),
  C + r * Math.sin((deg * Math.PI) / 180),
];

/** Nœuds cuivre du logo complet : cinq points reliés en chaîne. */
export const NOEUDS = [[-104, 34], [-30, 37], [40, 33], [104, 31], [170, 35]]
  .map(([d, r]) => polaire(d, r));

/**
 * Formes composant la marque, dans l'ordre de tracé.
 * `avecReseau` distingue le logo d'interface du favicon : à 16 px, un nœud
 * cuivre fait moins d'un pixel et se réduit à du bruit.
 */
export function formes({ avecReseau }) {
  const opt = avecReseau ? OPT_MARQUE : OPT_FAVICON;
  const couleurs = avecReseau ? PALETTE : PALETTE.slice(0, 5);
  const out = couleurs.map((couleur, i) => ({
    couleur,
    points: paleSommets(opt, (360 / couleurs.length) * i),
  }));

  out.push({ couleur: COEUR, points: cercleSommets(C, C, avecReseau ? 8 : 10) });

  if (avecReseau) {
    for (let i = 0; i < NOEUDS.length - 1; i++) {
      out.push({ couleur: CUIVRE, points: segmentSommets(NOEUDS[i], NOEUDS[i + 1], 2.2) });
    }
    for (const [x, y] of NOEUDS) {
      out.push({ couleur: CUIVRE, points: cercleSommets(x, y, 4.4) });
    }
  }
  return out;
}

// ──────────────────────────────── Sortie SVG ─────────────────────────────────

export function svg({ avecReseau, commentaire = '' }) {
  const corps = formes({ avecReseau }).map(({ couleur, points }) => {
    const d = points.map(([x, y], i) => `${i ? 'L' : 'M'}${n2(x)} ${n2(y)}`).join('') + 'Z';
    return `  <path d="${d}" fill="${couleur}"/>`;
  }).join('\n');

  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" ' +
    `role="img" aria-label="Buildex">\n${commentaire}${corps}\n</svg>\n`;
}

// ─────────────────────────────── Rastérisation ───────────────────────────────

const hex = (c) => [
  parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16),
];

/**
 * Remplit les formes dans un tampon RGBA.
 *
 * Suréchantillonnage 3×3 puis moyenne : sans lui, les pointes de pale
 * produisent un escalier très visible dès 32 px. Un vrai anticrénelage par
 * couverture exacte serait plus juste, mais trois fois plus de code pour un
 * écart invisible à ces tailles.
 */
export function rasteriser({ taille, avecReseau, fond = null, marge = 0 }) {
  const SS = 3;
  const N = taille * SS;
  const acc = new Float32Array(N * N * 4);

  if (fond) {
    const [r, g, b] = hex(fond);
    for (let i = 0; i < N * N; i++) {
      acc[i * 4] = r; acc[i * 4 + 1] = g; acc[i * 4 + 2] = b; acc[i * 4 + 3] = 255;
    }
  }

  const utile = 100 + marge * 2;
  const ech = N / utile;
  const dec = marge;

  for (const { couleur, points } of formes({ avecReseau })) {
    const [r, g, b] = hex(couleur);
    const pts = points.map(([x, y]) => [(x + dec) * ech, (y + dec) * ech]);

    let yMin = Infinity;
    let yMax = -Infinity;
    for (const [, y] of pts) { if (y < yMin) yMin = y; if (y > yMax) yMax = y; }
    const y0 = Math.max(0, Math.floor(yMin));
    const y1 = Math.min(N - 1, Math.ceil(yMax));

    for (let y = y0; y <= y1; y++) {
      const cy = y + 0.5;
      // Balayage : abscisses des intersections avec les arêtes, triées, puis
      // remplissage entre paires. Règle pair-impair, suffisante ici — aucune
      // de nos formes ne s'auto-intersecte.
      const xs = [];
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const [xi, yi] = pts[i];
        const [xj, yj] = pts[j];
        if ((yi > cy) !== (yj > cy)) xs.push(xi + ((cy - yi) / (yj - yi)) * (xj - xi));
      }
      xs.sort((a, b2) => a - b2);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const xa = Math.max(0, Math.ceil(xs[k] - 0.5));
        const xb = Math.min(N - 1, Math.floor(xs[k + 1] - 0.5));
        for (let x = xa; x <= xb; x++) {
          const o = (y * N + x) * 4;
          acc[o] = r; acc[o + 1] = g; acc[o + 2] = b; acc[o + 3] = 255;
        }
      }
    }
  }

  // Réduction : moyenne des SS×SS sous-pixels.
  const out = Buffer.alloc(taille * taille * 4);
  for (let y = 0; y < taille; y++) {
    for (let x = 0; x < taille; x++) {
      let r = 0; let g = 0; let b = 0; let a = 0;
      for (let dy = 0; dy < SS; dy++) {
        for (let dx = 0; dx < SS; dx++) {
          const o = ((y * SS + dy) * N + (x * SS + dx)) * 4;
          const al = acc[o + 3] / 255;
          r += acc[o] * al; g += acc[o + 1] * al; b += acc[o + 2] * al; a += al;
        }
      }
      const o = (y * taille + x) * 4;
      // Couleur moyennée sur les seuls sous-pixels couverts : sinon les bords
      // tirent vers le noir, la couleur des pixels vides.
      out[o] = a ? Math.round(r / a) : 0;
      out[o + 1] = a ? Math.round(g / a) : 0;
      out[o + 2] = a ? Math.round(b / a) : 0;
      out[o + 3] = Math.round((a / (SS * SS)) * 255);
    }
  }
  return out;
}

// ──────────────────────────────── Encodeurs ──────────────────────────────────

const crcTable = (() => {
  const t = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c;
  }
  return t;
})();

const crc32 = (buf) => {
  let c = -1;
  for (const octet of buf) c = crcTable[(c ^ octet) & 0xFF] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};

const morceau = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const corps = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(corps));
  return Buffer.concat([len, corps, crc]);
};

/** PNG 8 bits RGBA, sans filtrage par ligne : nos aplats compressent déjà bien. */
export function png(rgba, taille) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(taille, 0);
  ihdr.writeUInt32BE(taille, 4);
  ihdr[8] = 8;   // profondeur
  ihdr[9] = 6;   // couleur : RGBA
  const brut = Buffer.alloc(taille * (taille * 4 + 1));
  for (let y = 0; y < taille; y++) {
    brut[y * (taille * 4 + 1)] = 0; // filtre None
    rgba.copy(brut, y * (taille * 4 + 1) + 1, y * taille * 4, (y + 1) * taille * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    morceau('IHDR', ihdr),
    morceau('IDAT', deflateSync(brut, { level: 9 })),
    morceau('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * ICO enveloppant des PNG. Windows l'accepte depuis Vista, et cela évite
 * d'écrire un encodeur DIB avec son masque de transparence hérité.
 */
export function ico(images) {
  const dir = Buffer.alloc(6);
  dir.writeUInt16LE(0, 0);
  dir.writeUInt16LE(1, 2); // type : icône
  dir.writeUInt16LE(images.length, 4);

  let decalage = 6 + images.length * 16;
  const entrees = [];
  for (const { taille, data } of images) {
    const e = Buffer.alloc(16);
    e[0] = taille >= 256 ? 0 : taille; // 0 signifie 256
    e[1] = taille >= 256 ? 0 : taille;
    e.writeUInt16LE(1, 4);   // plans
    e.writeUInt16LE(32, 6);  // bits par pixel
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(decalage, 12);
    decalage += data.length;
    entrees.push(e);
  }
  return Buffer.concat([dir, ...entrees, ...images.map((i) => i.data)]);
}

/**
 * BMP 24 bits, sans compression. NSIS n'accepte que ce format pour ses
 * bandeaux d'installateur — ni PNG, ni transparence.
 */
export function bmp(rgba, largeur, hauteur, fond = '#FFFFFF') {
  const [fr, fg, fb] = hex(fond);
  const pad = (4 - ((largeur * 3) % 4)) % 4;
  const tailleLignes = (largeur * 3 + pad) * hauteur;
  const buf = Buffer.alloc(54 + tailleLignes);

  buf.write('BM', 0, 'ascii');
  buf.writeUInt32LE(buf.length, 2);
  buf.writeUInt32LE(54, 10);
  buf.writeUInt32LE(40, 14);
  buf.writeInt32LE(largeur, 18);
  buf.writeInt32LE(hauteur, 22);   // positif : lignes stockées de bas en haut
  buf.writeUInt16LE(1, 26);
  buf.writeUInt16LE(24, 28);
  buf.writeUInt32LE(tailleLignes, 34);

  let o = 54;
  for (let y = hauteur - 1; y >= 0; y--) {
    for (let x = 0; x < largeur; x++) {
      const s = (y * largeur + x) * 4;
      const a = rgba[s + 3] / 255;
      // Aplatissement sur le fond : le BMP 24 bits ne porte pas d'alpha.
      buf[o++] = Math.round(rgba[s + 2] * a + fb * (1 - a));
      buf[o++] = Math.round(rgba[s + 1] * a + fg * (1 - a));
      buf[o++] = Math.round(rgba[s] * a + fr * (1 - a));
    }
    o += pad;
  }
  return buf;
}

/** Insère une image RGBA dans une toile plus grande, à la position voulue. */
export function poser(toile, largeurToile, image, taille, x0, y0) {
  for (let y = 0; y < taille; y++) {
    for (let x = 0; x < taille; x++) {
      const s = (y * taille + x) * 4;
      const d = ((y0 + y) * largeurToile + (x0 + x)) * 4;
      if (d < 0 || d + 3 >= toile.length) continue;
      const a = image[s + 3] / 255;
      if (a === 0) continue;
      toile[d] = Math.round(image[s] * a + toile[d] * (1 - a));
      toile[d + 1] = Math.round(image[s + 1] * a + toile[d + 1] * (1 - a));
      toile[d + 2] = Math.round(image[s + 2] * a + toile[d + 2] * (1 - a));
      toile[d + 3] = 255;
    }
  }
}
