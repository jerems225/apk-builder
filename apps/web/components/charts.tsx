'use client';

import React from 'react';
import type { SeriesPoint } from '@/lib/types';
import { day, number } from '@/lib/format';

/**
 * Graphiques SVG écrits à la main.
 *
 * Pourquoi pas une bibliothèque : trois formes suffisent ici, et une
 * bibliothèque de graphiques pèse plus lourd que tout le reste de l'interface
 * réunie. Écrire le SVG donne aussi la main sur les deux points qui font la
 * différence à la lecture — les espaces entre segments empilés, et les
 * extrémités arrondies côté valeur seulement.
 *
 * Le couple de couleurs bleu/rouge n'est pas un choix esthétique : vert/rouge,
 * le réflexe habituel pour « réussi/échoué », est indistinguable en vision
 * deutéranope (ΔE 4,1 mesuré). Bleu/rouge passe à 23,8. Le libellé de la
 * légende reste de toute façon le porteur principal de l'information.
 */

const SERIES = {
  success: { color: 'var(--series-1)', label: 'Réussis' },
  failed: { color: 'var(--series-2)', label: 'Échoués' },
};

// ───────────────────────── Activité : barres empilées ────────────────────────

export function ActivityChart({ data, height = 210 }: { data: SeriesPoint[]; height?: number }) {
  const [hover, setHover] = React.useState<number | null>(null);
  const ref = React.useRef<HTMLDivElement>(null);

  const max = Math.max(1, ...data.map((d) => d.total));
  // Graduation ronde : 1, 2, 5 × 10ⁿ. Un axe qui affiche « 0 / 3,5 / 7 » se lit
  // moins vite qu'un axe qui affiche « 0 / 5 / 10 ».
  const step = niceStep(max);
  const top = Math.ceil(max / step) * step;
  const ticks = Array.from({ length: top / step + 1 }, (_, i) => i * step);

  const PAD = { top: 8, right: 4, bottom: 22, left: 30 };
  const plotH = height - PAD.top - PAD.bottom;

  const empty = data.every((d) => d.total === 0);

  return (
    <div className="relative px-5 pb-5" ref={ref}>
      <Legend items={[SERIES.success, SERIES.failed]} />

      <div className="relative" style={{ height }}>
        <svg width="100%" height={height} role="img"
          aria-label={`Builds par jour sur ${data.length} jours`}
          onMouseLeave={() => setHover(null)}>
          {/* Grille en filet : présente pour situer, jamais pour attirer l'œil. */}
          {ticks.map((t) => {
            const y = PAD.top + plotH - (t / top) * plotH;
            return (
              <g key={t}>
                <line x1={PAD.left} x2="100%" y1={y} y2={y}
                  stroke={t === 0 ? 'var(--baseline)' : 'var(--grid)'} strokeWidth="1" />
                <text x={PAD.left - 8} y={y + 3.5} textAnchor="end"
                  fontSize="10.5" fill="var(--ink-3)" className="tnum">{t}</text>
              </g>
            );
          })}

          <BarLayer
            data={data} top={top} pad={PAD} plotH={plotH}
            hover={hover} onHover={setHover}
          />
        </svg>

        {empty && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center">
            <p className="text-[13px]" style={{ color: 'var(--ink-3)' }}>
              Aucun build sur la période.
            </p>
          </div>
        )}
      </div>

      {hover !== null && data[hover] && (
        <Tooltip
          x={`calc(${PAD.left}px + (100% - ${PAD.left}px) * ${(hover + 0.5) / data.length})`}
          point={data[hover]}
        />
      )}
    </div>
  );
}

/**
 * Couche des barres, en pourcentage de largeur pour rester fluide sans mesurer
 * le conteneur. Chaque jour a sa zone de survol pleine hauteur : viser une
 * barre de 3 px de haut à la souris serait impraticable.
 */
function BarLayer({
  data, top, pad, plotH, hover, onHover,
}: {
  data: SeriesPoint[]; top: number; pad: { top: number; left: number; bottom: number; right: number };
  plotH: number; hover: number | null; onHover: (i: number | null) => void;
}) {
  const n = data.length;
  const slot = 100 / n; // en pourcentage de la zone traçable
  const barRatio = 0.62;

  return (
    <g>
      <svg x={pad.left} width={`calc(100% - ${pad.left}px)`} height={plotH + pad.top + pad.bottom}
        overflow="visible">
        {data.map((d, i) => {
          const cx = (i + 0.5) * slot;
          const w = slot * barRatio;
          const x = cx - w / 2;
          const hSuccess = (d.success / top) * plotH;
          const hFailed = (d.failed / top) * plotH;
          // 2 px de surface entre les deux segments : sans cet interstice, un
          // empilement se lit comme une seule barre bicolore.
          const gap = d.success > 0 && d.failed > 0 ? 2 : 0;
          const yFailedTop = pad.top + plotH - hSuccess - gap - hFailed;
          const isOn = hover === i;

          return (
            <g key={d.date} opacity={hover === null || isOn ? 1 : 0.42}
              style={{ transition: 'opacity .12s' }}>
              {d.success > 0 && (
                <Segment x={x} w={w} y={pad.top + plotH - hSuccess} h={hSuccess}
                  fill={SERIES.success.color} roundTop={d.failed === 0} />
              )}
              {d.failed > 0 && (
                <Segment x={x} w={w} y={yFailedTop} h={hFailed}
                  fill={SERIES.failed.color} roundTop />
              )}
              {/* Cible de survol : toute la colonne, pas seulement la barre. */}
              <rect x={`${i * slot}%`} width={`${slot}%`} y={0} height={plotH + pad.top}
                fill="transparent" onMouseEnter={() => onHover(i)}
                style={{ cursor: 'crosshair' }} />
            </g>
          );
        })}

        {/* Étiquettes d'axe : une sur cinq, sinon elles se chevauchent. */}
        {data.map((d, i) =>
          i % Math.ceil(n / 6) === 0 || i === n - 1 ? (
            <text key={`t${d.date}`} x={`${(i + 0.5) * slot}%`} y={plotH + pad.top + 15}
              textAnchor="middle" fontSize="10.5" fill="var(--ink-3)">
              {day(d.date)}
            </text>
          ) : null)}
      </svg>
    </g>
  );
}

/**
 * Segment de barre. L'extrémité côté valeur est arrondie à 4 px, le pied reste
 * carré : une barre arrondie en bas semble décollée de sa ligne de base, ce qui
 * fausse la lecture des petites valeurs.
 *
 * Deux rectangles superposés plutôt qu'un chemin : la largeur est exprimée en
 * pourcentage pour rester fluide, et un chemin SVG n'accepte pas de pourcentage.
 */
function Segment({
  x, w, y, h, fill, roundTop,
}: { x: number; w: number; y: number; h: number; fill: string; roundTop: boolean }) {
  const height = Math.max(h, 2);
  const r = Math.min(4, height / 2);
  return (
    <>
      <rect x={`${x}%`} width={`${w}%`} y={y} height={height} fill={fill}
        rx={roundTop ? r : 0} />
      {roundTop && height > r && (
        <rect x={`${x}%`} width={`${w}%`} y={y + height - r} height={r} fill={fill} />
      )}
    </>
  );
}

function Tooltip({ x, point }: { x: string; point: SeriesPoint }) {
  return (
    <div className="pointer-events-none absolute -translate-x-1/2 rounded-lg px-3 py-2 text-[12px] shadow-lg"
      style={{
        left: x, bottom: 42, background: 'var(--surface)',
        border: '1px solid var(--line-strong)', minWidth: 132,
      }}>
      <p className="mb-1 font-semibold" style={{ color: 'var(--ink)' }}>{day(point.date)}</p>
      <Row color={SERIES.success.color} label={SERIES.success.label} value={point.success} />
      <Row color={SERIES.failed.color} label={SERIES.failed.label} value={point.failed} />
    </div>
  );
}

function Row({ color, label, value }: { color: string; label: string; value: number }) {
  return (
    <div className="flex items-center justify-between gap-4 leading-5">
      <span className="flex items-center gap-1.5" style={{ color: 'var(--ink-2)' }}>
        <span className="h-2 w-2 rounded-[2px]" style={{ background: color }} />
        {label}
      </span>
      <span className="font-semibold tnum" style={{ color: 'var(--ink)' }}>{value}</span>
    </div>
  );
}

function Legend({ items }: { items: { color: string; label: string }[] }) {
  return (
    <div className="mb-2 flex items-center gap-4">
      {items.map((s) => (
        <span key={s.label} className="flex items-center gap-1.5 text-[12px]"
          style={{ color: 'var(--ink-2)' }}>
          <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: s.color }} />
          {s.label}
        </span>
      ))}
    </div>
  );
}

function niceStep(max: number) {
  const raw = max / 4;
  const mag = 10 ** Math.floor(Math.log10(Math.max(raw, 1)));
  for (const m of [1, 2, 5, 10]) if (raw <= m * mag) return m * mag;
  return 10 * mag;
}

// ──────────────────────────── Jauge de taux ──────────────────────────────────

/**
 * Arc semi-circulaire. Une seule valeur, donc pas de légende : le titre de la
 * carte la nomme. La valeur est écrite en clair au centre — l'arc situe, le
 * chiffre informe.
 */
export function Gauge({
  value, caption, target,
}: { value: number; caption?: string; target?: number }) {
  const R = 62;
  const CX = 80;
  const CY = 78;
  const arc = (from: number, to: number) => {
    const a1 = Math.PI * (1 + from);
    const a2 = Math.PI * (1 + to);
    const large = to - from > 0.5 ? 1 : 0;
    return `M ${CX + R * Math.cos(a1)} ${CY + R * Math.sin(a1)} ` +
      `A ${R} ${R} 0 ${large} 1 ${CX + R * Math.cos(a2)} ${CY + R * Math.sin(a2)}`;
  };
  const pct = Math.max(0, Math.min(100, value)) / 100;

  return (
    <div className="flex flex-col items-center px-5 pb-5">
      <svg width="160" height="96" viewBox="0 0 160 96" role="img"
        aria-label={`Taux de réussite : ${value} %`}>
        <path d={arc(0, 1)} fill="none" stroke="var(--grid)" strokeWidth="11" strokeLinecap="round" />
        {pct > 0 && (
          <path d={arc(0, pct)} fill="none" stroke="var(--series-1)" strokeWidth="11"
            strokeLinecap="round" style={{ transition: 'd .4s' }} />
        )}
        {target !== undefined && (
          <line
            x1={CX + (R - 9) * Math.cos(Math.PI * (1 + target / 100))}
            y1={CY + (R - 9) * Math.sin(Math.PI * (1 + target / 100))}
            x2={CX + (R + 9) * Math.cos(Math.PI * (1 + target / 100))}
            y2={CY + (R + 9) * Math.sin(Math.PI * (1 + target / 100))}
            stroke="var(--ink-3)" strokeWidth="1.5" strokeDasharray="2 2" />
        )}
        <text x={CX} y={CY - 4} textAnchor="middle" fontSize="27" fontWeight="600"
          fill="var(--ink)">{value} %</text>
      </svg>
      {caption && (
        <p className="mt-1 text-center text-[12.5px]" style={{ color: 'var(--ink-3)' }}>{caption}</p>
      )}
    </div>
  );
}

// ─────────────────────── Classement en barres horizontales ───────────────────

export function RankBars({
  items, unit = 'builds',
}: { items: { label: string; value: number; href?: string }[]; unit?: string }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <ul className="space-y-3 px-5 pb-5">
      {items.map((it) => (
        <li key={it.label}>
          <div className="mb-1 flex items-baseline justify-between gap-3">
            <span className="truncate text-[13px]" style={{ color: 'var(--ink-2)' }}>{it.label}</span>
            <span className="shrink-0 text-[12.5px] font-semibold tnum" style={{ color: 'var(--ink)' }}>
              {number(it.value)} <span style={{ color: 'var(--ink-3)' }}>{unit}</span>
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full" style={{ background: 'var(--grid)' }}>
            <div className="h-full rounded-full"
              style={{ width: `${(it.value / max) * 100}%`, background: 'var(--series-1)' }} />
          </div>
        </li>
      ))}
    </ul>
  );
}
