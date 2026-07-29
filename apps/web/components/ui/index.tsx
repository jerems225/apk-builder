'use client';

import React from 'react';

/**
 * Briques d'interface communes. Regroupées dans un seul fichier volontairement :
 * ce sont dix composants de vingt lignes, les éclater en dix fichiers coûterait
 * plus de navigation qu'il n'apporterait de clarté.
 */

export const cx = (...parts: (string | false | null | undefined)[]) =>
  parts.filter(Boolean).join(' ');

// ──────────────────────────────── Carte ──────────────────────────────────────

export function Card({ className, children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cx('card', className)} {...rest}>{children}</div>;
}

export function CardHeader(
  { title, subtitle, action }: { title: React.ReactNode; subtitle?: React.ReactNode; action?: React.ReactNode },
) {
  return (
    <div className="flex items-start justify-between gap-4 px-5 pt-5 pb-4">
      <div className="min-w-0">
        <h2 className="text-[15px] font-semibold leading-tight" style={{ color: 'var(--ink)' }}>{title}</h2>
        {subtitle && (
          <p className="mt-1 text-[12.5px] leading-snug" style={{ color: 'var(--ink-3)' }}>{subtitle}</p>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

// ──────────────────────────────── Bouton ─────────────────────────────────────

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md';
  loading?: boolean;
  icon?: React.ReactNode;
};

export function Button({
  variant = 'secondary', size = 'md', loading, icon, className, children, disabled, ...rest
}: ButtonProps) {
  const base =
    'inline-flex items-center justify-center gap-2 rounded-lg font-medium ' +
    'transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap';
  const sizes = { sm: 'h-8 px-3 text-[13px]', md: 'h-9.5 px-4 text-[13.5px]' };
  const styles: Record<string, React.CSSProperties> = {
    primary: { background: 'var(--accent)', color: 'var(--accent-ink)' },
    secondary: { background: 'var(--surface)', color: 'var(--ink)', border: '1px solid var(--line-strong)' },
    ghost: { background: 'transparent', color: 'var(--ink-2)' },
    danger: { background: 'var(--danger-wash)', color: 'var(--danger-ink)', border: '1px solid transparent' },
  };
  return (
    <button
      className={cx(base, sizes[size], variant === 'ghost' && 'hover:opacity-80',
        variant !== 'ghost' && 'hover:brightness-[.97]', className)}
      style={styles[variant]}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? <Spinner /> : icon}
      {children}
    </button>
  );
}

export function Spinner({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden className="animate-spin">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" opacity=".2" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

// ─────────────────────────────── Formulaire ──────────────────────────────────

export function Field({
  label, hint, error, children, required,
}: {
  label: string; hint?: React.ReactNode; error?: string; children: React.ReactNode; required?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-baseline gap-1.5 text-[12.5px] font-semibold"
        style={{ color: 'var(--ink-2)' }}>
        {label}
        {required && <span style={{ color: 'var(--danger)' }}>*</span>}
      </span>
      {children}
      {error
        ? <span className="mt-1 block text-[12px]" style={{ color: 'var(--danger-ink)' }}>{error}</span>
        : hint
          ? <span className="mt-1 block text-[12px] leading-snug" style={{ color: 'var(--ink-3)' }}>{hint}</span>
          : null}
    </label>
  );
}

const inputStyle: React.CSSProperties = {
  background: 'var(--surface)',
  border: '1px solid var(--line-strong)',
  color: 'var(--ink)',
};

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...rest }, ref) {
    return (
      <input ref={ref} className={cx('h-9.5 w-full rounded-lg px-3 text-[13.5px] outline-none', className)}
        style={inputStyle} {...rest} />
    );
  });

export function Select({ className, children, ...rest }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cx('h-9.5 w-full rounded-lg px-2.5 text-[13.5px] outline-none', className)}
      style={inputStyle} {...rest}>
      {children}
    </select>
  );
}

export function Toggle({
  checked, onChange, label,
}: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}
      className="inline-flex items-center gap-2.5 text-[13.5px]"
      style={{ color: 'var(--ink)' }}
    >
      <span className="relative h-5 w-9 rounded-full transition-colors"
        style={{ background: checked ? 'var(--accent)' : 'var(--line-strong)' }}>
        <span className="absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all"
          style={{ left: checked ? 18 : 2 }} />
      </span>
      {label}
    </button>
  );
}

// ──────────────────────────────── Pastilles ──────────────────────────────────

const TONES = {
  ok: { bg: 'var(--ok-wash)', fg: 'var(--ok-ink)', dot: 'var(--ok)' },
  warn: { bg: 'var(--warn-wash)', fg: 'var(--warn-ink)', dot: 'var(--warn)' },
  danger: { bg: 'var(--danger-wash)', fg: 'var(--danger-ink)', dot: 'var(--danger)' },
  idle: { bg: 'var(--idle-wash)', fg: 'var(--idle-ink)', dot: 'var(--ink-3)' },
  run: { bg: 'var(--accent-wash)', fg: 'var(--accent)', dot: 'var(--accent)' },
} as const;

export type Tone = keyof typeof TONES;

/**
 * Pastille d'état. Elle porte toujours un libellé : la couleur seule est
 * illisible pour une part non négligeable des lecteurs, et le point coloré
 * n'est là que comme repère secondaire.
 */
export function Badge({
  tone = 'idle', children, pulse,
}: { tone?: Tone; children: React.ReactNode; pulse?: boolean }) {
  const t = TONES[tone];
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[12px] font-medium"
      style={{ background: t.bg, color: t.fg }}>
      <span className={cx('h-1.5 w-1.5 rounded-full', pulse && 'animate-pulse')}
        style={{ background: t.dot }} />
      {children}
    </span>
  );
}

/** Variation par rapport à la période précédente. La flèche double la couleur. */
export function Delta({ value, invert }: { value: number | null; invert?: boolean }) {
  if (value === null) {
    return <span className="text-[12px]" style={{ color: 'var(--ink-3)' }}>pas de comparaison</span>;
  }
  const good = invert ? value <= 0 : value >= 0;
  const tone = value === 0 ? 'idle' : good ? 'ok' : 'danger';
  const t = TONES[tone];
  return (
    <span className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[12px] font-semibold tnum"
      style={{ background: t.bg, color: t.fg }}>
      <span aria-hidden>{value > 0 ? '▲' : value < 0 ? '▼' : '■'}</span>
      {Math.abs(value)} %
    </span>
  );
}

// ──────────────────────────────── Modale ─────────────────────────────────────

export function Modal({
  open, onClose, title, subtitle, children, footer, wide,
}: {
  open: boolean; onClose: () => void; title: string; subtitle?: string;
  children: React.ReactNode; footer?: React.ReactNode; wide?: boolean;
}) {
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    // Le fond ne doit pas défiler derrière la modale : sur mobile, c'est la
    // première chose qui trahit une boîte de dialogue mal faite.
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-6"
      role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0" style={{ background: 'rgba(9,13,22,.5)' }} onClick={onClose} />
      <div className={cx('card rise relative flex max-h-[92vh] w-full flex-col overflow-hidden',
        'rounded-b-none sm:rounded-b-[14px]', wide ? 'sm:max-w-2xl' : 'sm:max-w-lg')}>
        <div className="px-5 pt-5 pb-3">
          <h2 className="text-[15.5px] font-semibold">{title}</h2>
          {subtitle && <p className="mt-1 text-[12.5px]" style={{ color: 'var(--ink-3)' }}>{subtitle}</p>}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">{children}</div>
        {footer && (
          <div className="flex justify-end gap-2 border-t px-5 py-3.5"
            style={{ borderColor: 'var(--line)', background: 'var(--surface-sunken)' }}>
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────── États vides et erreurs ──────────────────────────

export function EmptyState({
  icon, title, description, action,
}: { icon?: React.ReactNode; title: string; description?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
      {icon && (
        <div className="grid h-11 w-11 place-items-center rounded-xl"
          style={{ background: 'var(--surface-sunken)', color: 'var(--ink-3)' }}>{icon}</div>
      )}
      <div>
        <p className="text-[14px] font-semibold">{title}</p>
        {description && (
          <p className="mx-auto mt-1 max-w-md text-[13px] leading-relaxed" style={{ color: 'var(--ink-3)' }}>
            {description}
          </p>
        )}
      </div>
      {action}
    </div>
  );
}

export function Alert({
  tone = 'warn', title, children,
}: { tone?: Tone; title?: string; children: React.ReactNode }) {
  const t = TONES[tone];
  return (
    <div className="rounded-lg px-3.5 py-3 text-[13px] leading-relaxed"
      style={{ background: t.bg, color: t.fg }}>
      {title && <p className="mb-0.5 font-semibold">{title}</p>}
      {children}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('skeleton', className)} />;
}
