import type { BuildStatus } from './types';

/**
 * Taille en base 1024 avec les symboles usuels. On affiche « Mo » et non
 * « Mio » : c'est ce que l'équipe lit et écrit, et un APK de 128 Mo dans
 * l'interface doit correspondre au 128 Mo affiché par le téléphone.
 */
export function bytes(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  if (n === 0) return '0 o';
  const units = ['o', 'Ko', 'Mo', 'Go'];
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), units.length - 1);
  const v = n / 1024 ** i;
  return `${v.toFixed(i === 0 ? 0 : v >= 100 ? 0 : 1).replace('.', ',')} ${units[i]}`;
}

/** Durée compacte : « 3 min 12 s ». Au-delà de l'heure, on tombe les secondes. */
export function duration(sec: number | null | undefined): string {
  if (sec === null || sec === undefined) return '—';
  if (sec < 60) return `${Math.round(sec)} s`;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  if (m < 60) return s ? `${m} min ${s} s` : `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

const dtf = new Intl.DateTimeFormat('fr-FR', {
  day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
});
const dayf = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: 'short' });
const longf = new Intl.DateTimeFormat('fr-FR', {
  weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  hour: '2-digit', minute: '2-digit',
});

export const dateTime = (v: string | Date | null | undefined) =>
  v ? dtf.format(new Date(v)) : '—';
export const day = (v: string | Date) => dayf.format(new Date(v));
export const fullDate = (v: string | Date | null | undefined) =>
  v ? longf.format(new Date(v)) : '—';

/** « il y a 4 min ». Repère plus utile qu'une date absolue sur un flux récent. */
export function relative(v: string | Date | null | undefined): string {
  if (!v) return '—';
  const diff = (Date.now() - new Date(v).getTime()) / 1000;
  if (diff < 45) return 'à l’instant';
  if (diff < 3600) return `il y a ${Math.round(diff / 60)} min`;
  if (diff < 86400) return `il y a ${Math.round(diff / 3600)} h`;
  if (diff < 7 * 86400) return `il y a ${Math.round(diff / 86400)} j`;
  return dateTime(v);
}

export const number = (n: number | null | undefined) =>
  n === null || n === undefined ? '—' : new Intl.NumberFormat('fr-FR').format(n);

/**
 * Variation en pourcentage entre deux périodes.
 * Retourne null quand la période précédente est vide : « +100 % » à partir de
 * zéro n'a aucun sens et donnerait une fausse impression de progression.
 */
export function delta(current: number, previous: number): number | null {
  if (!previous) return null;
  return Math.round(((current - previous) / previous) * 100);
}

export const STATUS: Record<BuildStatus, { label: string; tone: 'ok' | 'warn' | 'danger' | 'idle' | 'run' }> = {
  success: { label: 'Réussi', tone: 'ok' },
  failed: { label: 'Échec', tone: 'danger' },
  running: { label: 'En cours', tone: 'run' },
  queued: { label: 'En file', tone: 'idle' },
  cancelled: { label: 'Annulé', tone: 'warn' },
};

/** Empreinte SHA-256 lisible : deux blocs, début et fin, séparateurs conservés. */
export function fingerprint(fp: string | null | undefined): string {
  if (!fp) return '—';
  const clean = fp.toUpperCase().replace(/[^0-9A-F]/g, '');
  if (clean.length < 16) return fp;
  const pairs = clean.match(/.{2}/g) || [];
  return `${pairs.slice(0, 4).join(':')} … ${pairs.slice(-4).join(':')}`;
}

export const initials = (name: string) =>
  name.trim().split(/\s+/).slice(0, 2).map((p) => p[0]).join('').toUpperCase() || '?';
