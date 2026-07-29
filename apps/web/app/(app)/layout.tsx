'use client';

import { SessionProvider } from '@/components/session';
import { AppShell } from '@/components/shell';

// Groupe de routes (app) : tout ce qui est ici est derrière la session et
// partage la coquille. Les parenthèses ne rentrent pas dans l'URL — /builds
// reste /builds.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <AppShell>{children}</AppShell>
    </SessionProvider>
  );
}
