'use client';

import Link from 'next/link';
import { PageHeader } from '@/components/shell';
import { Card, CardHeader, Alert } from '@/components/ui';
import { IconDoc } from '@/components/ui/icons';

/**
 * Page d'aide.
 *
 * Elle ne répète pas la documentation de l'API : elle répond aux questions qui
 * reviennent réellement en support, dans l'ordre où elles arrivent. Chaque
 * réponse dit ce qui se passe ET pourquoi, parce qu'une explication qu'on
 * comprend évite le ticket suivant.
 */

const QUESTIONS = [
  {
    q: 'Mon push n’a déclenché aucun build.',
    a: (
      <>
        Trois causes, par ordre de fréquence. <strong>La branche n’est pas surveillée</strong> :
        vérifiez la liste dans la fiche du projet. <strong>Le secret ne correspond pas</strong> :
        l’onglet <em>Recent Deliveries</em> de GitHub affiche la raison exacte du rejet, recopiée
        depuis le serveur. <strong>Le projet est désactivé</strong> : l’interrupteur est dans la
        fiche du projet.
      </>
    ),
  },
  {
    q: 'L’installation de l’APK échoue avec « conflit avec un package existant ».',
    a: (
      <>
        L’appareil a déjà une version de l’application signée par une <em>autre</em> clé. Android
        refuse catégoriquement une mise à jour signée différemment — il n’existe aucun
        contournement. La seule issue côté utilisateur est de désinstaller puis réinstaller, en
        perdant les données locales de l’application. C’est précisément ce que la{' '}
        <Link href="/projets" className="font-semibold underline underline-offset-2">
          clé de signature par projet
        </Link>{' '}
        est là pour éviter à l’avenir : une clé stable, sauvegardée, qui ne change plus.
      </>
    ),
  },
  {
    q: 'Pourquoi mon APK pèse 130 Mo ?',
    a: (
      <>
        Un APK universel embarque quatre copies de chaque bibliothèque native (arm64-v8a,
        armeabi-v7a, x86, x86_64). Limiter les architectures à <code>arm64-v8a</code> dans la fiche
        du projet divise nettement le poids. Deux réserves : les téléphones 32 bits, grosso modo
        d’avant 2015, ne l’installeront pas, et les émulateurs QA tournent souvent en{' '}
        <code>x86_64</code>. Le réglage est par projet précisément pour cette raison.
        <br /><br />
        Attention : sous React Native 0.71, ce réglage est ignoré <em>silencieusement</em>. Le
        build réussit sans rien réduire — la comparaison des tailles avant/après dans l’historique
        est le seul moyen de s’en apercevoir.
      </>
    ),
  },
  {
    q: 'Un build reste « en file » sans démarrer.',
    a: (
      <>
        Deux plafonds s’appliquent : celui de la machine et celui de votre espace. Le bandeau en
        haut à droite indique combien de builds tournent. Si les deux compteurs sont pleins,
        le build démarrera dès qu’une place se libère. Si les compteurs sont à zéro et que rien ne
        bouge, le service de build est probablement arrêté côté serveur.
      </>
    ),
  },
  {
    q: 'Puis-je compiler pour iOS ?',
    a: (
      <>
        Non. La compilation iOS exige macOS et un poste Apple : c’est une contrainte d’Apple, pas
        une limite de cette plateforme. Aucune configuration ne permet de la contourner sur un
        serveur Linux.
      </>
    ),
  },
  {
    q: 'Qui peut voir mes liens de téléchargement ?',
    a: (
      <>
        Tout le monde. Les liens <code>/dl/…</code> et <code>/latest/…</code> sont publics et
        permanents — c’est un choix assumé : les APK sont installés par des utilisateurs finaux qui
        n’ont pas de compte ici, et un lien authentifié rendrait l’installation impraticable. Ne
        distribuez donc que ce que vous acceptez de voir circuler.
      </>
    ),
  },
  {
    q: 'Que se passe-t-il si je perds le fichier .jks ?',
    a: (
      <>
        L’application ne peut plus jamais être mise à jour. Aucune autorité ne régénère une clé
        Android — il n’y a pas d’équivalent d’un certificat SSL qu’on redemande. Sauvegardez le
        fichier <em>et</em> son mot de passe hors de ce serveur, là où vivent les autres secrets de
        l’équipe.
      </>
    ),
  },
  {
    q: 'Android affiche un avertissement Play Protect à l’installation.',
    a: (
      <>
        Attendu hors du Play Store. Une clé de release stable permet à la réputation de se
        construire avec le volume d’installations, mais ne supprime rien immédiatement. En
        pratique, une page d’installation guidée règle plus de tickets de support que n’importe
        quel changement technique.
      </>
    ),
  },
];

export default function HelpPage() {
  return (
    <>
      <PageHeader title="Aide"
        subtitle="Les questions qui reviennent, et ce qu’il faut comprendre pour ne plus se les poser." />

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          {QUESTIONS.map((item) => (
            <Card key={item.q} className="p-5">
              <h2 className="text-[14.5px] font-semibold">{item.q}</h2>
              <div className="mt-2 text-[13px] leading-relaxed" style={{ color: 'var(--ink-2)' }}>
                {item.a}
              </div>
            </Card>
          ))}
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Limites connues"
              subtitle="Assumées, documentées, à ne pas redécouvrir." />
            <ul className="space-y-2.5 border-t px-5 py-4 text-[13px] leading-relaxed"
              style={{ borderColor: 'var(--line)', color: 'var(--ink-2)' }}>
              <li><strong>iOS impossible</strong> — exige macOS.</li>
              <li><strong>Liens publics et permanents</strong> — choix explicite.</li>
              <li><strong>Pas d’envoi de courriel</strong> — les mots de passe provisoires se
                transmettent de la main à la main.</li>
              <li><strong>Un seul APK par build</strong> — pas de <code>splits.abi</code>.</li>
            </ul>
          </Card>

          <Card className="p-5">
            <div className="mb-2 flex items-center gap-2">
              <IconDoc size={17} />
              <h2 className="text-[14.5px] font-semibold">Documentation de l’API</h2>
            </div>
            <p className="text-[13px] leading-relaxed" style={{ color: 'var(--ink-2)' }}>
              Toutes les routes, leurs paramètres et les rôles qu’elles exigent. Accessible avec les
              mêmes identifiants que cette interface.
            </p>
            <a href="/api/docs" target="_blank" rel="noreferrer"
              className="mt-3 inline-block text-[13px] font-semibold" style={{ color: 'var(--accent)' }}>
              Ouvrir la documentation →
            </a>
          </Card>

          <Alert tone="warn" title="Avant de changer une clé de signature">
            Faites-le sur une version qui le justifie, prévenez les utilisateurs, et vérifiez ce que
            l’application stocke en local — session, brouillons, cache hors ligne — puisque tout
            cela sera perdu à la réinstallation.
          </Alert>
        </div>
      </div>
    </>
  );
}
