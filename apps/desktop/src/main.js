'use strict';
/**
 * Client de bureau Buildex.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CE QU'IL EST, ET CE QU'IL N'EST PAS
 *
 * Une coquille autour de l'interface servie par votre serveur, pas une copie
 * locale de l'application.
 *
 * C'est un choix, pas un raccourci : le builder a besoin de son serveur pour
 * absolument tout — Docker, les clés de signature, les artefacts. Embarquer
 * l'interface dans l'exécutable obligerait à redéployer un installateur à
 * chaque correctif d'écran, pour une application qui reste inutilisable hors
 * réseau. Ici, une mise à jour du serveur profite immédiatement à tout le
 * monde.
 *
 * Ce que la version de bureau apporte par rapport à un onglet de navigateur :
 *   - des notifications système quand un build se termine, même fenêtre fermée ;
 *   - les téléchargements d'APK rangés sans boîte de dialogue ;
 *   - une fenêtre dédiée, qui ne se perd pas dans trente onglets.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const { app, BrowserWindow, Menu, Notification, session, shell, dialog, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const FICHIER_CONFIG = () => path.join(app.getPath('userData'), 'configuration.json');
const INTERVALLE_SONDAGE = 20_000;

let fenetre = null;
let sondage = null;
/** Dernier état connu de chaque build, pour ne notifier que les changements. */
const etatsConnus = new Map();

// ─────────────────────────────── Configuration ───────────────────────────────

function lireConfig() {
  try {
    return JSON.parse(fs.readFileSync(FICHIER_CONFIG(), 'utf8'));
  } catch {
    return {};
  }
}

function ecrireConfig(config) {
  fs.mkdirSync(path.dirname(FICHIER_CONFIG()), { recursive: true });
  fs.writeFileSync(FICHIER_CONFIG(), JSON.stringify(config, null, 2), 'utf8');
}

/** Normalise une adresse saisie à la main : « build.exemple.tech » suffit. */
function normaliserUrl(brut) {
  const s = String(brut || '').trim().replace(/\/+$/, '');
  if (!s) return null;
  const avecSchema = /^https?:\/\//i.test(s) ? s : `https://${s}`;
  try {
    const u = new URL(avecSchema);
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

// ──────────────────────────────── Fenêtre ────────────────────────────────────

function creerFenetre() {
  const config = lireConfig();
  const bornes = config.fenetre || {};

  fenetre = new BrowserWindow({
    width: bornes.width || 1280,
    height: bornes.height || 860,
    x: bornes.x,
    y: bornes.y,
    minWidth: 900,
    minHeight: 600,
    // La barre de titre reprend le fond de l'interface : sans cela, un
    // bandeau blanc surmonte une application en thème sombre.
    backgroundColor: '#0a0e17',
    show: false,
    icon: path.join(__dirname, '..', 'build', 'icone.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      // Isolation stricte : la page vient du réseau, elle n'a aucune raison
      // d'accéder à Node.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  // Affichage différé : montrer une fenêtre blanche puis la remplir donne
  // l'impression d'un démarrage raté.
  fenetre.once('ready-to-show', () => fenetre.show());

  fenetre.on('close', () => {
    if (!fenetre || fenetre.isDestroyed()) return;
    const c = lireConfig();
    ecrireConfig({ ...c, fenetre: fenetre.getNormalBounds() });
  });

  fenetre.on('closed', () => { fenetre = null; });

  // Tout lien sortant part dans le navigateur du système. Une fenêtre Electron
  // sans barre d'adresse est un mauvais endroit pour ouvrir GitHub.
  fenetre.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  fenetre.webContents.on('will-navigate', (e, url) => {
    const serveur = lireConfig().serveur;
    if (serveur && !url.startsWith(serveur) && !url.startsWith('file://')) {
      e.preventDefault();
      shell.openExternal(url);
    }
  });

  fenetre.webContents.on('did-fail-load', (_e, code, description, url) => {
    // -3 est une navigation interrompue par l'application elle-même, pas une
    // erreur : la signaler affolerait pour rien.
    if (code === -3) return;
    fenetre.webContents.executeJavaScript(
      `document.title = ${JSON.stringify(`Buildex — ${description}`)}`,
    ).catch(() => {});
    dialog.showMessageBox(fenetre, {
      type: 'warning',
      title: 'Serveur injoignable',
      message: `Impossible d’atteindre ${url}`,
      detail: `${description}\n\nVérifiez que le serveur répond, ou changez son adresse ` +
        'dans le menu Fichier.',
      buttons: ['Réessayer', 'Changer de serveur'],
      defaultId: 0,
    }).then(({ response }) => {
      if (response === 0) charger();
      else ouvrirConfiguration();
    });
  });

  charger();
}

function charger() {
  const serveur = lireConfig().serveur;
  if (!serveur) return ouvrirConfiguration();
  fenetre.loadURL(serveur);
}

function ouvrirConfiguration() {
  fenetre.loadFile(path.join(__dirname, 'configuration.html'));
}

// ──────────────────────────── Téléchargements ────────────────────────────────

/**
 * Les APK partent directement dans le dossier de téléchargements, sans boîte
 * de dialogue : c'est le geste le plus répété de l'application, et le nom du
 * fichier est déjà décidé par le serveur.
 */
function brancherTelechargements() {
  session.defaultSession.on('will-download', (_e, item) => {
    const cible = path.join(app.getPath('downloads'), item.getFilename());
    item.setSavePath(cible);

    item.once('done', (__e, etat) => {
      if (etat === 'completed') {
        const notif = new Notification({
          title: 'Téléchargement terminé',
          body: item.getFilename(),
          silent: false,
        });
        notif.on('click', () => shell.showItemInFolder(cible));
        notif.show();
      } else if (etat === 'interrupted') {
        new Notification({
          title: 'Téléchargement interrompu',
          body: item.getFilename(),
        }).show();
      }
    });
  });
}

// ─────────────────────── Notifications de fin de build ───────────────────────

/**
 * Sonde l'API et notifie les builds qui viennent de se terminer.
 *
 * La requête part de la session d'Electron : elle porte donc le cookie de la
 * personne connectée dans la fenêtre, sans avoir à gérer d'authentification
 * séparée. Tant que personne n'est connecté, l'API répond 401 et on ne fait
 * rien — c'est le comportement voulu, pas une panne.
 *
 * Vingt secondes : assez pour que la notification arrive pendant qu'on regarde
 * ailleurs, assez peu pour ne pas peser sur un serveur qui compile.
 */
async function sonder() {
  const config = lireConfig();
  if (!config.serveur || config.notifications === false) return;

  try {
    const rep = await session.defaultSession.fetch(`${config.serveur}/api/builds?limit=25`);
    if (!rep.ok) return;
    const { items } = await rep.json();
    if (!Array.isArray(items)) return;

    const premierPassage = etatsConnus.size === 0;
    for (const b of items) {
      const avant = etatsConnus.get(b.id);
      etatsConnus.set(b.id, b.status);

      // Au premier passage, on enregistre sans notifier : sinon l'ouverture de
      // l'application déclencherait une notification par build déjà terminé.
      if (premierPassage || !avant || avant === b.status) continue;
      if (avant !== 'running' && avant !== 'queued') continue;
      if (b.status !== 'success' && b.status !== 'failed') continue;

      const reussi = b.status === 'success';
      const notif = new Notification({
        title: reussi ? 'Build réussi' : 'Build en échec',
        body: `${b.projectName || b.repoName} · ${b.ref}` +
          (reussi && b.appVersion ? ` · v${b.appVersion}` : ''),
        urgency: reussi ? 'normal' : 'critical',
      });
      notif.on('click', () => {
        if (!fenetre || fenetre.isDestroyed()) creerFenetre();
        else { fenetre.show(); fenetre.focus(); }
        fenetre.loadURL(`${config.serveur}/builds/${b.id}`);
      });
      notif.show();
    }
  } catch {
    // Serveur injoignable : la fenêtre le signale déjà, inutile d'en rajouter.
  }
}

// ────────────────────────────────── Menu ─────────────────────────────────────

function construireMenu() {
  const config = lireConfig();

  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: 'Fichier',
      submenu: [
        { label: 'Actualiser', accelerator: 'F5', click: () => fenetre && fenetre.reload() },
        { type: 'separator' },
        { label: 'Changer de serveur…', click: () => { etatsConnus.clear(); ouvrirConfiguration(); } },
        {
          label: 'Notifications de fin de build',
          type: 'checkbox',
          checked: config.notifications !== false,
          click: (item) => {
            ecrireConfig({ ...lireConfig(), notifications: item.checked });
          },
        },
        { type: 'separator' },
        { label: 'Quitter', accelerator: 'Alt+F4', role: 'quit' },
      ],
    },
    {
      label: 'Édition',
      submenu: [
        { label: 'Annuler', role: 'undo' },
        { label: 'Rétablir', role: 'redo' },
        { type: 'separator' },
        { label: 'Couper', role: 'cut' },
        { label: 'Copier', role: 'copy' },
        { label: 'Coller', role: 'paste' },
        { label: 'Tout sélectionner', role: 'selectAll' },
      ],
    },
    {
      label: 'Affichage',
      submenu: [
        { label: 'Taille normale', role: 'resetZoom' },
        { label: 'Agrandir', role: 'zoomIn' },
        { label: 'Réduire', role: 'zoomOut' },
        { type: 'separator' },
        { label: 'Plein écran', role: 'togglefullscreen' },
        { label: 'Outils de développement', role: 'toggleDevTools' },
      ],
    },
    {
      label: 'Aide',
      submenu: [
        {
          label: 'Documentation de l’API',
          click: () => {
            const s = lireConfig().serveur;
            if (s) shell.openExternal(`${s}/api/docs`);
          },
        },
        {
          label: 'Ouvrir dans le navigateur',
          click: () => {
            const s = lireConfig().serveur;
            if (s) shell.openExternal(s);
          },
        },
        { type: 'separator' },
        {
          label: 'À propos',
          click: () => dialog.showMessageBox(fenetre, {
            type: 'info',
            title: 'À propos de Buildex',
            message: `Buildex ${app.getVersion()}`,
            detail: [
              `Serveur : ${lireConfig().serveur || 'non configuré'}`,
              `Electron ${process.versions.electron} · Chromium ${process.versions.chrome}`,
              '',
              'Cette application affiche l’interface servie par votre serveur.',
              'Les mises à jour de l’interface arrivent sans réinstaller.',
            ].join('\n'),
            buttons: ['Fermer'],
          }),
        },
      ],
    },
  ]));
}

// ─────────────────────────────── Démarrage ───────────────────────────────────

// Une seule instance : deux fenêtres sur le même serveur donneraient des
// notifications en double.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!fenetre) return;
    if (fenetre.isMinimized()) fenetre.restore();
    fenetre.focus();
  });

  app.whenReady().then(() => {
    brancherTelechargements();
    construireMenu();
    creerFenetre();
    sondage = setInterval(sonder, INTERVALLE_SONDAGE);

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) creerFenetre();
    });
  });

  app.on('window-all-closed', () => {
    if (sondage) clearInterval(sondage);
    if (process.platform !== 'darwin') app.quit();
  });
}

// ───────────────────────── Écran de configuration ────────────────────────────

ipcMain.handle('buildex:configuration', () => ({
  serveur: lireConfig().serveur || '',
  version: app.getVersion(),
}));

/** Vérifie l'adresse avant de l'enregistrer : mieux vaut refuser ici. */
ipcMain.handle('buildex:verifier', async (_e, brut) => {
  const url = normaliserUrl(brut);
  if (!url) return { ok: false, message: 'Adresse invalide.' };
  try {
    const rep = await session.defaultSession.fetch(`${url}/healthz`, { cache: 'no-store' });
    if (!rep.ok) return { ok: false, message: `Le serveur a répondu ${rep.status}.` };
    const etat = await rep.json();
    if (!etat || etat.ok !== true) {
      return { ok: false, message: 'Cette adresse répond, mais ce n’est pas un serveur Buildex.' };
    }
    return {
      ok: true,
      url,
      message: etat.crypto === false
        ? 'Serveur joignable, mais son chiffrement est indisponible : signalez-le à l’exploitant.'
        : 'Serveur joignable.',
    };
  } catch (e) {
    return { ok: false, message: `Injoignable : ${e.message}` };
  }
});

ipcMain.handle('buildex:enregistrer', (_e, url) => {
  const propre = normaliserUrl(url);
  if (!propre) return { ok: false };
  ecrireConfig({ ...lireConfig(), serveur: propre });
  etatsConnus.clear();
  construireMenu();
  charger();
  return { ok: true };
});
