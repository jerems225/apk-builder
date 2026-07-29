'use client';

import React from 'react';
import { Button } from './ui';
import { IconDownload, IconClose, IconAlert } from './ui/icons';

/**
 * Branchement PWA : enregistrement du service worker, invitation à installer,
 * bandeau hors-ligne.
 *
 * Rien n'est fait en développement : un service worker qui met en cache la
 * coquille pendant qu'on modifie le code sert des fichiers périmés et fait
 * perdre une demi-heure avant qu'on comprenne pourquoi.
 */
export function PWA() {
  const [horsLigne, setHorsLigne] = React.useState(false);
  const [invite, setInvite] = React.useState<BeforeInstallPromptEvent | null>(null);
  const [maj, setMaj] = React.useState(false);

  React.useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (!('serviceWorker' in navigator)) return;

    navigator.serviceWorker.register('/sw.js').then((reg) => {
      // Une nouvelle version installée pendant que l'onglet est ouvert reste
      // en attente : on propose de recharger plutôt que de le faire de force,
      // un rechargement au milieu d'une saisie serait mal vécu.
      reg.addEventListener('updatefound', () => {
        const nouveau = reg.installing;
        if (!nouveau) return;
        nouveau.addEventListener('statechange', () => {
          if (nouveau.state === 'installed' && navigator.serviceWorker.controller) setMaj(true);
        });
      });
    }).catch(() => { /* pas de PWA : l'application marche quand même */ });
  }, []);

  React.useEffect(() => {
    const majEtat = () => setHorsLigne(!navigator.onLine);
    majEtat();
    window.addEventListener('online', majEtat);
    window.addEventListener('offline', majEtat);

    const surInvite = (e: Event) => {
      e.preventDefault();
      setInvite(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', surInvite);

    return () => {
      window.removeEventListener('online', majEtat);
      window.removeEventListener('offline', majEtat);
      window.removeEventListener('beforeinstallprompt', surInvite);
    };
  }, []);

  // `navigator.onLine` ne dit que si une interface réseau est active, pas si le
  // serveur répond. Le bandeau signale donc une coupure évidente, pas une panne
  // du service — que la page d'erreur des écrans traite déjà.
  return (
    <>
      {horsLigne && (
        <div className="fixed inset-x-0 top-0 z-[60] flex items-center justify-center gap-2 px-4 py-1.5 text-[12.5px] font-medium"
          style={{ background: 'var(--warn-wash)', color: 'var(--warn-ink)' }}>
          <IconAlert size={14} />
          Hors ligne — les informations affichées datent du dernier chargement.
        </div>
      )}

      {maj && (
        <Bandeau
          texte="Une nouvelle version de l’interface est prête."
          action={<Button size="sm" variant="primary" onClick={() => location.reload()}>Recharger</Button>}
          onFermer={() => setMaj(false)}
        />
      )}

      {invite && !maj && (
        <Bandeau
          texte="Installer Buildex comme application ?"
          action={
            <Button size="sm" variant="primary" icon={<IconDownload size={15} />}
              onClick={async () => {
                await invite.prompt();
                setInvite(null);
              }}>
              Installer
            </Button>
          }
          onFermer={() => setInvite(null)}
        />
      )}
    </>
  );
}

function Bandeau({
  texte, action, onFermer,
}: { texte: string; action: React.ReactNode; onFermer: () => void }) {
  return (
    <div className="card rise fixed bottom-4 left-1/2 z-[60] flex w-[min(440px,calc(100vw-2rem))] -translate-x-1/2 items-center gap-3 px-4 py-3 shadow-xl">
      <span className="min-w-0 flex-1 text-[13px]">{texte}</span>
      {action}
      <button onClick={onFermer} aria-label="Fermer"
        className="grid h-7 w-7 shrink-0 place-items-center rounded-lg"
        style={{ color: 'var(--ink-3)' }}>
        <IconClose size={14} />
      </button>
    </div>
  );
}

/**
 * L'évènement d'installation n'est pas standardisé : Chrome et Edge le
 * proposent, Firefox et Safari non. Le type est donc déclaré ici plutôt
 * qu'importé.
 */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}
