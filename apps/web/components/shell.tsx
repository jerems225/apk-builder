'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession } from './session';
import { cx, Badge } from './ui';
import { initials } from '@/lib/format';
import {
  IconDashboard, IconBuilds, IconProjects, IconLink, IconTeam, IconSettings,
  IconHelp, IconSearch, IconSun, IconMoon, IconLogout, IconMenu, IconClose,
  IconChevronDown, IconDoc, IconKey,
} from './ui/icons';

// ─────────────────────────────── Navigation ──────────────────────────────────

const NAV = [
  { href: '/tableau-de-bord', label: 'Tableau de bord', Icon: IconDashboard },
  { href: '/builds', label: 'Builds', Icon: IconBuilds },
  { href: '/projets', label: 'Projets', Icon: IconProjects },
  { href: '/connexions', label: 'Connexions Git', Icon: IconLink },
];

const NAV_ADMIN = [
  { href: '/equipe', label: 'Équipe', Icon: IconTeam, minimum: 'OWNER' as const },
  { href: '/parametres', label: 'Paramètres', Icon: IconSettings, minimum: 'MAINTAINER' as const },
];

// ────────────────────────────────── Thème ────────────────────────────────────

/**
 * Le thème est écrit dans localStorage et posé sur <html> par un script inline
 * (voir app/layout.tsx). Ce composant ne fait que le basculer : la valeur est
 * déjà en place quand React s'hydrate, donc pas de clignotement.
 */
function ThemeToggle() {
  const [dark, setDark] = React.useState(false);

  React.useEffect(() => {
    setDark(document.documentElement.getAttribute('data-theme') === 'dark');
  }, []);

  const toggle = () => {
    const next = dark ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('apkb.theme', next); } catch { /* mode privé */ }
    setDark(!dark);
  };

  return (
    <button onClick={toggle} className="grid h-9 w-9 place-items-center rounded-lg transition-colors"
      style={{ color: 'var(--ink-2)' }}
      aria-label={dark ? 'Passer en thème clair' : 'Passer en thème sombre'}
      title={dark ? 'Thème clair' : 'Thème sombre'}>
      {dark ? <IconSun /> : <IconMoon />}
    </button>
  );
}

// ─────────────────────────── Sélecteur d'espace ──────────────────────────────

function WorkspaceSwitcher({ collapsed }: { collapsed?: boolean }) {
  const { user, workspace, switchWorkspace } = useSession();
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  if (!workspace) return null;
  const many = (user?.workspaces.length ?? 0) > 1;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => many && setOpen(!open)}
        className={cx('flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors',
          many && 'hover:bg-[var(--surface-sunken)]')}
        aria-haspopup={many ? 'listbox' : undefined} aria-expanded={open}>
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[13px] font-bold"
          style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}>
          {workspace.name.slice(0, 2).toUpperCase()}
        </span>
        {!collapsed && (
          <>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13.5px] font-semibold">{workspace.name}</span>
              <span className="block truncate text-[11.5px]" style={{ color: 'var(--ink-3)' }}>
                {workspace.roleLabel ?? workspace.role}
              </span>
            </span>
            {many && <IconChevronDown size={15} className="shrink-0 opacity-50" />}
          </>
        )}
      </button>

      {open && (
        <div className="card rise absolute left-0 right-0 top-full z-30 mt-1 overflow-hidden p-1 shadow-xl"
          role="listbox">
          {user?.workspaces.map((w) => (
            <button key={w.id} role="option" aria-selected={w.slug === workspace.slug}
              onClick={() => switchWorkspace(w.slug)}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] hover:bg-[var(--surface-sunken)]">
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-[10.5px] font-bold"
                style={{ background: 'var(--accent-wash)', color: 'var(--accent)' }}>
                {w.name.slice(0, 2).toUpperCase()}
              </span>
              <span className="min-w-0 flex-1 truncate">{w.name}</span>
              {w.slug === workspace.slug && (
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: 'var(--accent)' }} />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ────────────────────────────── Barre latérale ───────────────────────────────

function NavLink({
  href, label, Icon, onNavigate,
}: { href: string; label: string; Icon: React.ComponentType<{ size?: number }>; onNavigate?: () => void }) {
  const pathname = usePathname();
  const active = pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link href={href} onClick={onNavigate}
      className="relative flex items-center gap-3 rounded-xl px-3 py-2 text-[13.5px] font-medium transition-colors"
      style={{
        background: active ? 'var(--accent-wash)' : 'transparent',
        color: active ? 'var(--accent)' : 'var(--ink-2)',
      }}
      aria-current={active ? 'page' : undefined}>
      {active && (
        <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r"
          style={{ background: 'var(--accent)' }} />
      )}
      <Icon size={18} />
      {label}
    </Link>
  );
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { can, user } = useSession();

  return (
    <div className="flex h-full flex-col gap-1 px-3 py-4">
      <div className="mb-2 px-1">
        <WorkspaceSwitcher />
      </div>

      <nav className="flex flex-col gap-0.5">
        {NAV.map((n) => <NavLink key={n.href} {...n} onNavigate={onNavigate} />)}
      </nav>

      <p className="mt-5 mb-1 px-3 text-[11px] font-semibold uppercase tracking-wider"
        style={{ color: 'var(--ink-3)' }}>
        Administration
      </p>
      <nav className="flex flex-col gap-0.5">
        {NAV_ADMIN.filter((n) => can(n.minimum))
          .map((n) => <NavLink key={n.href} {...n} onNavigate={onNavigate} />)}
      </nav>

      <div className="flex-1" />

      {/* Encart d'aide : c'est ici que se règlent 90 % des tickets de support,
          autant mettre le lien sous les yeux plutôt que dans un menu. */}
      <div className="rounded-xl p-3.5" style={{ background: 'var(--accent-wash)' }}>
        <div className="mb-1.5 flex items-center gap-2">
          <IconKey size={16} />
          <p className="text-[13px] font-semibold" style={{ color: 'var(--ink)' }}>Clés de signature</p>
        </div>
        <p className="text-[12px] leading-relaxed" style={{ color: 'var(--ink-2)' }}>
          Sans clé de release, un APK ne peut pas être mis à jour par-dessus une version
          antérieure.
        </p>
        <Link href="/projets"
          className="mt-2 inline-block text-[12.5px] font-semibold"
          style={{ color: 'var(--accent)' }}>
          Vérifier mes projets →
        </Link>
      </div>

      <nav className="mt-2 flex flex-col gap-0.5">
        <a href="/api/docs" target="_blank" rel="noreferrer"
          className="flex items-center gap-3 rounded-xl px-3 py-2 text-[13.5px] font-medium"
          style={{ color: 'var(--ink-2)' }}>
          <IconDoc size={18} />
          Documentation de l’API
        </a>
        <Link href="/aide" onClick={onNavigate}
          className="flex items-center gap-3 rounded-xl px-3 py-2 text-[13.5px] font-medium"
          style={{ color: 'var(--ink-2)' }}>
          <IconHelp size={18} />
          Aide
        </Link>
      </nav>

      {user?.isSuperAdmin && (
        <p className="mt-2 px-3 text-[11px]" style={{ color: 'var(--ink-3)' }}>
          Connecté en super-administrateur.
        </p>
      )}
    </div>
  );
}

// ──────────────────────────────── Barre haute ────────────────────────────────

function UserMenu() {
  const { user, logout } = useSession();
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  if (!user) return null;

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen(!open)}
        className="grid h-9 w-9 place-items-center rounded-full text-[12px] font-bold text-white"
        style={{ background: user.avatarColor }}
        aria-label="Menu du compte" aria-expanded={open}>
        {initials(user.name)}
      </button>

      {open && (
        <div className="card rise absolute right-0 top-full z-30 mt-1.5 w-60 overflow-hidden p-1 shadow-xl">
          <div className="px-3 py-2.5">
            <p className="truncate text-[13.5px] font-semibold">{user.name}</p>
            <p className="truncate text-[12px]" style={{ color: 'var(--ink-3)' }}>{user.email}</p>
          </div>
          <div className="my-1 h-px" style={{ background: 'var(--line)' }} />
          <Link href="/compte" onClick={() => setOpen(false)}
            className="block rounded-lg px-3 py-2 text-[13px] hover:bg-[var(--surface-sunken)]">
            Mon compte
          </Link>
          <button onClick={logout}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] hover:bg-[var(--surface-sunken)]"
            style={{ color: 'var(--danger-ink)' }}>
            <IconLogout size={16} />
            Se déconnecter
          </button>
        </div>
      )}
    </div>
  );
}

function CommandHint() {
  return (
    <div className="hidden items-center gap-2 rounded-xl px-3 md:flex"
      style={{ background: 'var(--surface-sunken)', border: '1px solid var(--line)', height: 38 }}>
      <IconSearch size={16} />
      <input
        placeholder="Rechercher un build, un projet…"
        className="w-56 bg-transparent text-[13px] outline-none lg:w-72"
        style={{ color: 'var(--ink)' }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            const q = (e.target as HTMLInputElement).value.trim();
            if (q) window.location.href = `/builds?q=${encodeURIComponent(q)}`;
          }
        }}
      />
    </div>
  );
}

// ───────────────────────────────── Coquille ──────────────────────────────────

export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, loading } = useSession();
  const [menuOpen, setMenuOpen] = React.useState(false);

  React.useEffect(() => {
    if (!loading && !user) window.location.href = '/connexion';
  }, [loading, user]);

  // Un compte créé par un administrateur doit changer son mot de passe avant
  // d'accéder au reste : le laisser circuler avec un secret transmis de vive
  // voix reviendrait à ne pas en avoir.
  React.useEffect(() => {
    if (user?.mustChangePassword && !window.location.pathname.startsWith('/compte')) {
      window.location.href = '/compte?motdepasse=1';
    }
  }, [user]);

  if (loading || !user) {
    return (
      <div className="grid min-h-screen place-items-center">
        <div className="flex items-center gap-3 text-[13px]" style={{ color: 'var(--ink-3)' }}>
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
          Chargement…
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen lg:flex">
      {/* Barre latérale — fixe au-delà de 1024 px, tiroir en dessous */}
      <aside className="hidden w-[248px] shrink-0 border-r lg:block"
        style={{ borderColor: 'var(--line)', background: 'var(--surface)' }}>
        <div className="sticky top-0 h-screen overflow-y-auto">
          <Sidebar />
        </div>
      </aside>

      {menuOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0" style={{ background: 'rgba(9,13,22,.5)' }}
            onClick={() => setMenuOpen(false)} />
          <aside className="rise absolute left-0 top-0 h-full w-[272px] overflow-y-auto"
            style={{ background: 'var(--surface)' }}>
            <Sidebar onNavigate={() => setMenuOpen(false)} />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-[60px] items-center gap-3 border-b px-4 lg:px-6"
          style={{
            borderColor: 'var(--line)',
            background: 'color-mix(in srgb, var(--surface) 88%, transparent)',
            backdropFilter: 'blur(8px)',
          }}>
          <button onClick={() => setMenuOpen(true)}
            className="grid h-9 w-9 place-items-center rounded-lg lg:hidden"
            style={{ color: 'var(--ink-2)' }} aria-label="Ouvrir le menu">
            {menuOpen ? <IconClose /> : <IconMenu />}
          </button>

          <CommandHint />
          <div className="flex-1" />
          <ServiceHealth />
          <ThemeToggle />
          <UserMenu />
        </header>

        <main className="min-w-0 flex-1 px-4 py-5 lg:px-6 lg:py-6">{children}</main>
      </div>
    </div>
  );
}

/** État du service de build, visible en permanence : c'est la première chose
 *  qu'on regarde quand un build ne démarre pas. */
function ServiceHealth() {
  const [state, setState] = React.useState<{ running: number; limit: number } | null>(null);

  React.useEffect(() => {
    const load = () => fetch('/healthz')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setState({ running: d.running, limit: d.limit }))
      .catch(() => setState(null));
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, []);

  if (!state) return null;
  return (
    <div className="hidden sm:block">
      <Badge tone={state.running > 0 ? 'run' : 'ok'} pulse={state.running > 0}>
        {state.running > 0 ? `${state.running}/${state.limit} en cours` : 'File vide'}
      </Badge>
    </div>
  );
}

// ─────────────────────────── En-tête de page ─────────────────────────────────

export function PageHeader({
  title, subtitle, actions,
}: { title: string; subtitle?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-[22px] font-semibold leading-tight tracking-[-.01em]">{title}</h1>
        {subtitle && (
          <p className="mt-1 text-[13px] leading-relaxed" style={{ color: 'var(--ink-3)' }}>{subtitle}</p>
        )}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
