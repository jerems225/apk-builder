# Buildex — client de bureau

Coquille Electron autour de l'interface servie par votre serveur Buildex.
Produit un installateur Windows (`.exe`), un paquet `.msi` pour le déploiement
par stratégie de groupe, et une version portable.

---

## Ce que c'est, et ce que ce n'est pas

**Ce n'est pas une copie locale de l'application.** La fenêtre charge l'interface
depuis votre serveur, comme le ferait un navigateur.

C'est un choix, pas un raccourci. Le builder a besoin de son serveur pour
absolument tout — Docker, les clés de signature, les artefacts. Embarquer
l'interface dans l'exécutable obligerait à publier un installateur à chaque
correctif d'écran, pour une application qui reste inutilisable hors réseau.
Ici, **une mise à jour du serveur profite immédiatement à tout le monde**, sans
réinstaller.

Ce que la version de bureau apporte par rapport à un onglet :

| | |
|---|---|
| **Notifications système** | Un build qui se termine prévient, même fenêtre en arrière-plan. Sondage toutes les 20 s, avec le cookie de la session ouverte dans la fenêtre |
| **Téléchargements rangés** | Les APK partent dans le dossier de téléchargements sans boîte de dialogue — c'est le geste le plus répété |
| **Une fenêtre dédiée** | Qui ne se perd pas au milieu de trente onglets |

---

## Construire

```bash
cd apps/desktop
npm install
npm run build          # .exe + .msi + portable
```

Ou une cible à la fois : `npm run build:exe`, `build:msi`, `build:portable`.

Les ressources graphiques — icônes et bandeaux d'installateur — sont produites
automatiquement avant chaque construction par `npm run ressources`, depuis la
géométrie de la marque (`apps/web/scripts/marque.mjs`). **Une seule source**
pour le favicon du web, le logo de l'interface et l'icône de l'exécutable.

### Où atterrissent les fichiers

`directories.output` lit la variable `BUILDEX_SORTIE`. Le disque système d'une
machine de compilation est vite étroit — Electron et ses caches pèsent plusieurs
gigaoctets :

```powershell
$env:BUILDEX_SORTIE = 'D:\buildex\sortie'
$env:ELECTRON_CACHE = 'D:\buildex\cache\electron'
$env:ELECTRON_BUILDER_CACHE = 'D:\buildex\cache\electron-builder'
$env:CSC_IDENTITY_AUTO_DISCOVERY = 'false'
npm run build
```

La dernière variable évite qu'electron-builder cherche un certificat de
signature qui n'existe pas et échoue là-dessus.

### Prérequis

- Windows, pour produire des binaires Windows sans machine virtuelle.
- Node 20 ou plus.
- Une connexion : la première construction télécharge Electron (~100 Mo), puis
  WiX pour la cible MSI. Les suivantes sont hors ligne.

---

## Publier vers le tableau de bord

Les installateurs se téléchargent depuis l'interface, dans **Application de
bureau**. Le serveur se contente de lister un répertoire :

```bash
scp D:/buildex/sortie/Buildex-*.exe D:/buildex/sortie/Buildex-*.msi \
    vps-builder:/tmp/

ssh vps-builder
sudo install -d -o apkbuild -g apkbuild -m 0755 /srv/apkbuild/desktop
sudo install -o apkbuild -g apkbuild -m 0644 /tmp/Buildex-*.exe /tmp/Buildex-*.msi \
     /srv/apkbuild/desktop/
```

Ils apparaissent immédiatement, **sans redémarrer le service**. Le
téléchargement est réservé aux comptes de la plateforme : contrairement à un
APK, destiné à des utilisateurs finaux sans compte, un exécutable en
téléchargement libre est une invitation qu'on ne tient pas à lancer.

Pour retirer une version, supprimez le fichier.

---

## Signature de code

**Les binaires ne sont pas signés.** Windows affiche donc « L'ordinateur a été
protégé par Windows » à la première exécution : *Informations complémentaires*
→ *Exécuter quand même*.

Un certificat d'éditeur se loue à l'année et ne change rien à ce que fait le
programme — il atteste seulement de l'identité de l'éditeur. Si vous en prenez
un, `electron-builder` le reprend par les variables `CSC_LINK` (chemin ou URL du
`.pfx`) et `CSC_KEY_PASSWORD` ; rien d'autre à modifier dans la configuration.

La page **Application de bureau** de l'interface explique cet avertissement aux
utilisateurs, pour qu'il n'arrive pas par surprise.

---

## Structure

```
apps/desktop/
├─ src/
│  ├─ main.js              processus principal : fenêtre, menu, notifications
│  ├─ preload.js           pont vers l'écran de configuration, trois appels
│  ├─ configuration.html   saisie et vérification de l'adresse du serveur
│  └─ marque.svg           produit, pour l'écran de configuration
├─ scripts/
│  └─ generer-ressources.mjs   ICO et BMP, sans dépendance
├─ build/                  produit : icônes et bandeaux
└─ electron-builder.yml
```

### Quelques décisions

**`contextIsolation` et `sandbox` actifs, `nodeIntegration` désactivé.** La page
vient du réseau : elle n'a aucune raison d'accéder à Node. Le `preload` expose
trois fonctions, et rien d'autre.

**Les liens sortants partent dans le navigateur du système.** Une fenêtre
Electron sans barre d'adresse est un mauvais endroit pour ouvrir GitHub.

**Une seule instance.** Deux fenêtres sur le même serveur donneraient des
notifications en double.

**L'adresse du serveur est vérifiée auprès de `/healthz` avant enregistrement.**
Mieux vaut refuser une adresse à la saisie qu'afficher une page blanche.

**Aucune mise à jour automatique.** L'interface se met à jour toute seule
puisqu'elle vient du serveur ; publier un mécanisme de mise à jour pour une
coquille qui change deux fois par an serait disproportionné.

---

## Configuration côté utilisateur

Rangée dans `%APPDATA%\Buildex\configuration.json` :

```json
{
  "serveur": "https://build.exemple.tech",
  "notifications": true,
  "fenetre": { "x": 120, "y": 60, "width": 1280, "height": 860 }
}
```

Elle survit à une désinstallation — réinstaller une version corrigée ne doit pas
obliger à tout ressaisir. Supprimez le dossier pour repartir de zéro.

Le menu **Fichier → Changer de serveur…** rouvre l'écran de configuration, et
**Notifications de fin de build** les désactive.
