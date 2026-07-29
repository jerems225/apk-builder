# Builder APK — React Native → Android

Plateforme de compilation et de distribution d'APK Android, multi-utilisateurs,
déclenchée par webhook Git. Équivalent maison d'Expo EAS Build, hébergé sur
votre propre serveur.

**https://build.upjunoo-preprod.tech**

---

## Ce qu'il fait, ce qu'il ne fait pas

|  |  |
|---|---|
| ✔ | Projets **Expo managed** (via `expo prebuild`) et **React Native bare** |
| ✔ | Détection automatique du gestionnaire de paquets (npm, yarn, pnpm, bun) |
| ✔ | Monorepos, via un sous-dossier configuré par projet |
| ✔ | **Signature de release par projet** — clé stable, sauvegardable, vérifiée à chaque build |
| ✔ | **Multi-espaces** — un espace par client, isolation complète des projets, builds et clés |
| ✔ | Lien permanent par application, qui sert toujours le dernier build réussi |
| ✔ | Documentation d'API interactive, derrière la même authentification que l'interface |
| ✘ | **iOS** — impossible sur Linux : Xcode exige macOS. Aucun contournement |
| ✘ | **Envoi de courriel** — pas de relais SMTP ; les mots de passe provisoires se transmettent à la main |
| ✘ | **Splits ABI** — un seul APK par build (voir « Taille de l'APK ») |

---

## Comment ça marche

```
git push / tag
      │
      ▼
POST /api/webhooks/<espace> ─── HMAC vérifié avec le secret DE CET ESPACE
      │                          refusé si invalide, avec la raison exacte
      ▼
File d'attente SQLite      2 plafonds : machine + espace
      │
      ▼
docker run --rm --cpus 3 --memory 8g  rn-android-builder:1
      │  clone → install → [prebuild si pas de android/]
      │  → gradlew <tâche> -PreactNativeArchitectures=<abis>
      │  → [zipalign + apksigner si le projet a une clé]
      ▼
/srv/apkbuild/artifacts/<uuid>/  ──▶  APK + build.log + meta.json
      │
      ▼
https://…/dl/<build>/<fichier>.apk     lien du build
https://…/latest/<espace>/<org>/<dépôt> lien permanent
```

---

## Architecture

Monorepo npm workspaces, deux applications, une seule origine publique.

```
apk-builder/
├─ apps/
│  ├─ api/                Express 4 + Prisma + worker Docker + Swagger
│  │  ├─ prisma/schema.prisma
│  │  └─ src/
│  │     ├─ index.js      point d'entrée, montage des routes
│  │     ├─ worker.js     file d'attente, conteneurs, purge
│  │     ├─ openapi.js    contrat d'API, écrit à la main
│  │     ├─ lib/          crypto, auth, rôles, keystore, webhook
│  │     ├─ routes/       une par domaine
│  │     └─ scripts/      seed, reprise des données v1
│  └─ web/                Next.js 15 (App Router) + Tailwind 4
│     ├─ app/(app)/       écrans authentifiés
│     ├─ components/      coquille, briques d'UI, graphiques SVG
│     └─ lib/             client HTTP, formats, types
├─ docker/                image de build (15 Go : JDK 17, SDK 34+35, NDK, Node 20)
├─ deploy/                systemd, vhosts, install.sh
└─ docs/                  démarches détaillées
```

**Pourquoi le worker vit dans l'API et non à part** : il pilote `docker run`.
Le séparer imposerait de partager le socket Docker entre deux processus, sans
gain d'isolation.

**Pourquoi SQLite** : la machine héberge déjà Supabase et Redis. Coupler le
builder à l'un ou l'autre le rendrait solidaire de leurs pannes. Le volume
attendu — quelques milliers de builds — tient sans difficulté.

**Pourquoi une seule origine** : le cookie de session est en `SameSite=Lax`, il
ne partirait pas vers une autre origine. Apache route `/api`, `/dl`, `/latest`
et `/healthz` vers l'API, tout le reste vers Next.js.

---

## Espaces de travail et rôles

Un **espace** = un client ou une équipe. C'est l'unité d'isolation : projets,
connexions Git, builds et clés de signature en dépendent tous.

| Rôle | Ce qu'il ajoute au précédent |
|---|---|
| **Observateur** | Consultation : builds, journaux, téléchargements |
| **Développeur** | Lance et relance des builds, les interrompt |
| **Mainteneur** | Projets, connexions Git, clés de signature, jetons API |
| **Propriétaire** | Équipe, paramètres de l'espace, retrait d'une clé, suppression |

Un rôle ne peut jamais en attribuer un plus large que le sien, et le dernier
propriétaire d'un espace ne peut pas être retiré — sans ce garde-fou, un espace
devient administrable par personne.

Le **super-administrateur** agit comme propriétaire partout. C'est le rôle
d'exploitation de la plateforme, pas un rôle client.

---

## Installation

```bash
git clone https://github.com/jerems225/apk-builder.git
cd apk-builder
sudo SERVER_NAME=build.exemple.tech ./deploy/install.sh
sudo certbot --apache -d build.exemple.tech
```

Le script est idempotent. Il crée l'utilisateur de service, l'arborescence,
`/srv/apkbuild/keystores` en `0700`, génère un `.env` avec des secrets
aléatoires — sans jamais réécrire un `.env` existant —, installe les
dépendances, applique le schéma, compile l'interface, construit l'image Docker,
pose les deux services systemd et le vhost.

Il affiche à la fin les identifiants du premier compte et le secret de webhook
du premier espace. **Ils ne sont lisibles qu'une fois.**

Options utiles : `--skip-image` (l'image existe déjà), `--skip-web` (API seule),
`--skip-vhost`.

### Développement local

```bash
npm install
cp .env.example .env        # renseigner ENCRYPTION_KEY : openssl rand -hex 32
export APKBUILD_ROOT="$PWD/.data"
npm run db:push
npm run seed
npm run dev:api             # 9100
npm run dev:web             # 3000 — proxifie /api vers 9100
```

---

## Migration depuis la version 1

La version 1 stockait tout dans les tables `builds`, `projects` et `providers`
d'un fichier SQLite. Le nouveau schéma Prisma utilise d'autres noms de tables :
les deux cohabitent dans le même fichier, la reprise se fait sans copie ni arrêt
prolongé.

```bash
# 1. Sauvegarder — non négociable
sudo cp /srv/apkbuild/data/apkbuild.db ~/apkbuild-avant-v2.db

# 2. Sauvegarder la clé de debug actuelle, avant toute autre chose.
#    Tant qu'elle existe, les applications déjà installées restent à jour.
sudo -u apkbuild cp /srv/apkbuild/cache/home/.android/debug.keystore \
     ~/debug.keystore-sauvegarde
keytool -list -v -keystore ~/debug.keystore-sauvegarde -storepass android \
  | grep -i -E "valid|alias"

# 3. Installer la v2
sudo ./deploy/install.sh

# 4. Reprendre les données
sudo -u apkbuild env HOME=/srv/apkbuild \
  npm --prefix /srv/apkbuild/app run migrate:legacy

# 5. Vérifier dans l'interface, puis archiver les anciennes tables
sudo -u apkbuild env HOME=/srv/apkbuild \
  npm --prefix /srv/apkbuild/app run migrate:legacy -- --archiver
```

Les identifiants de build sont conservés : **les liens `/dl/…` déjà distribués
continuent de fonctionner**, et les répertoires d'artefacts n'ont pas à bouger.
Les jetons Git chiffrés sont repris tels quels — même format, même clé maîtresse,
rien à ressaisir.

### Ce qui change pour les webhooks

L'URL devient `/api/webhooks/<espace>`, avec un secret propre à chaque espace.
L'ancienne route `/webhook` reste servie et vise l'espace le plus ancien (ou
celui de `LEGACY_WORKSPACE_SLUG`), en traçant chaque appel dans le journal —
c'est ainsi qu'on sait quand la migration est terminée et que la route peut
disparaître.

---

## Signature de release

**Le point qui change tout.** Sans clé de release, un APK est signé avec la clé
de debug d'Android : alias `androiddebugkey`, mot de passe `android`, partagée
par le monde entier. Elle est régénérée si le cache du serveur est vidé — et ce
jour-là, plus aucune mise à jour ne s'installe par-dessus l'existant.
L'utilisateur doit désinstaller, donc perdre ses données locales.

Une clé **par projet**, et non une clé unique : les projets sont livrés à des
clients distincts, chacun doit garder une identité de publication séparée.

### La créer depuis l'interface

**Projets → Créer une clé.** Un formulaire — alias, nom de l'application,
organisation, ville, pays, validité, taille — et le serveur s'occupe du reste.

C'est la voie recommandée. Demander à chacun d'installer un JDK et de composer
une ligne de `keytool` correcte produit en pratique des clés RSA 2048 valides un
an, des alias oubliés et des mots de passe choisis à la main. Ici les paramètres
sont ceux qu'on veut, à chaque fois :

- **PKCS12 et non JKS** — JKS est hérité, `keytool` avertit à chaque usage.
- **RSA 4096, 30 ans** par défaut — une clé qui expire condamne l'application à
  changer d'identité.
- **Mot de passe tiré au sort sur 32 octets** — personne ne le choisit, donc
  personne ne le réutilise ailleurs. En PKCS12, magasin et clé le partagent : le
  format ne sait pas en gérer deux distincts.
- Le fichier produit est **relu** pour en extraire l'empreinte réelle, puis rangé
  en `0600` dans un répertoire qu'aucune route ne dessert.

L'écran suivant affiche le mot de passe et propose le téléchargement du magasin
et d'un pense-bête. **Il refuse de se fermer avant que ce soit fait** : une clé
qui n'existe que sur ce serveur meurt avec lui.

Un propriétaire peut re-télécharger le magasin plus tard — **Gérer la clé →
Sauvegarder** — en ressaisissant son propre mot de passe. Cette
ré-authentification est ce qui distingue une demande légitime d'une session
volée, et chaque export est inscrit au journal d'activité.

### Ou déposer un magasin existant

**Projets → Gérer la clé → Déposer un autre magasin**, si l'application est déjà
publiée avec une clé que vous détenez. Le fichier est ouvert par `keytool` avant
d'être accepté : un mot de passe faux, un alias absent ou un fichier corrompu
sont signalés au dépôt, pas au bout d'un build de dix minutes.

Pour la générer vous-même en ligne de commande :

```bash
keytool -genkeypair -v \
  -keystore mon-app.jks \
  -storetype PKCS12 \
  -alias mon-app \
  -keyalg RSA -keysize 4096 \
  -validity 10950 \
  -dname "CN=Mon application, O=Mon organisation, L=Abidjan, C=CI"
```

Dans tous les cas, le mot de passe est chiffré en base et jamais réaffiché hors
d'un export authentifié : on reconnaît sa clé à son empreinte.

> ⚠️ **Changer la clé d'une application déjà distribuée** oblige chaque
> utilisateur à désinstaller puis réinstaller. Android refuse catégoriquement une
> mise à jour signée différemment ; aucun contournement n'existe. Planifiez le
> basculement sur une version qui le justifie, et commencez par un projet sans
> utilisateurs en production.

**Sauvegardez le `.jks` et son mot de passe hors du serveur.** Aucune autorité
ne régénère une clé Android : sa perte est définitive.

### Le contrôle qui compte

Chaque build enregistre l'empreinte **réellement apposée**, relevée par
`apksigner`. Si elle diffère de celle du projet, l'écran de détail l'affiche en
rouge. C'est le seul moyen de repérer une régression de signature avant qu'un
utilisateur ne signale une installation refusée.

Le piège attendu : le gabarit React Native déclare un `signingConfig` de release
qui pointe vers la clé de **debug**. `assembleRelease` ne produit donc pas un APK
non signé mais un APK mal signé — d'où le `zip -d` qui retire la signature
héritée avant d'apposer la nôtre.

---

## Taille de l'APK

Il n'existe **aucun réglage de niveau de compression** dans le plugin Android de
Gradle. Depuis AGP 8, les bibliothèques natives sont même délibérément stockées
non compressées : l'APK est plus gros, mais l'empreinte réelle après
installation est plus petite — et c'est elle qui provoque les échecs
d'installation.

Les gains viennent donc de ce qu'on **retire**, pas de la compression.

| Levier | Où | Effet |
|---|---|---|
| Une seule architecture | Fiche du projet | Le plus gros gain immédiat |
| `assembleRelease` | Fiche du projet | Retire symboles de débogage et runtime de debug |
| R8 + `shrinkResources` | Dépôt du projet | Casse le code par réflexion : opt-in, avec règles ProGuard |
| `resConfigs "fr","en"` | Dépôt du projet | Écarte les traductions AndroidX inutilisées |
| Images en WebP | Dépôt du projet | Souvent le plus gros gain réel, et le plus ignoré |

Les deux premiers sont à la main du builder. Les trois suivants appartiennent
aux équipes applicatives — à leur signaler, pas à leur imposer.

**Réserves sur `arm64-v8a` seul** : les téléphones 32 bits (d'avant 2015) ne
l'installeront pas, et les émulateurs QA tournent souvent en `x86_64`. C'est
précisément pourquoi le réglage est par projet.

**Sous React Native 0.71**, la propriété `reactNativeArchitectures` est ignorée
*silencieusement* : le build réussit sans rien réduire. La comparaison des
tailles dans l'historique est le seul moyen de s'en apercevoir.

Chaque build trace les vingt entrées les plus lourdes de l'archive et le total
des `.so` par architecture. Pas besoin de récupérer l'APK pour savoir ce qui
pèse.

---

## Sécurité — ce qui est protégé, et ce qui ne l'est pas

**Protégé.** Jetons Git, mots de passe de magasin de clés et secrets de webhook
sont chiffrés en AES-256-GCM avec `ENCRYPTION_KEY`. Mots de passe utilisateurs
en scrypt (N=2¹⁵). Sessions et jetons API : seul le SHA-256 est stocké, un accès
en lecture à la base ne permet pas d'usurper une session. Les secrets ne sont
transmis au conteneur que par un fichier en `0600` — jamais en argument de
`docker run`, dont la ligne de commande est lisible par tout compte de la
machine. Le magasin de clés est monté en lecture seule.

**Non protégé, et c'est assumé.** La clé maîtresse est dans
`/srv/apkbuild/.env`, sur la même machine que la base : le chiffrement protège
contre la fuite d'un fichier `.db` ou d'une sauvegarde, pas contre un accès root
à l'hôte.

**Public par choix.** Les liens `/dl/…` et `/latest/…` sont ouverts et
permanents. Les APK sont installés par des utilisateurs finaux sans compte ;
un lien authentifié rendrait l'installation impraticable. Toute personne
disposant de l'URL peut télécharger l'application, sans limite de durée.

---

## Transférer des builds ou un projet

Un client change d'espace, une équipe se scinde, un projet part chez un
prestataire : **Builds → cocher → Transférer**, ou **Projets → Transférer** pour
emmener le projet avec sa clé et son historique.

Le rôle **Propriétaire est exigé des deux côtés**. L'exiger d'un seul
permettrait soit de verser les builds d'un client dans un espace qu'on contrôle,
soit d'aspirer ceux d'un espace voisin.

Ce qui suit, ce qui ne suit pas :

| | |
|---|---|
| **La clé de signature** | Suit le projet — le magasin est rangé par identifiant de projet, qui ne change pas. Les mises à jour restent installables |
| **Les liens de téléchargement** | Continuent de fonctionner — les artefacts sont rangés par identifiant de build, pas par espace |
| **La connexion Git** | **Ne suit pas.** Elle appartient à l'espace d'origine ; la recopier dupliquerait un jeton d'accès. Rattachez-en une avant le prochain build d'un dépôt privé |
| **Les builds en file ou en cours** | Refusés. Le worker les réclame avec le plafond de leur espace |

Des builds transférés sans projet d'accueil arrivent détachés : historique et
téléchargements intacts, mais plus de lien vers des réglages. L'opération est
inscrite au journal des **deux** espaces.

## Exploitation

```bash
# Journaux
journalctl -u apkbuild-api -u apkbuild-web -f

# État
systemctl status apkbuild-api apkbuild-web
curl -s https://build.exemple.tech/healthz | jq

# Espace disque — les artefacts sont ce qui grossit
du -sh /srv/apkbuild/*

# Sauvegarde : la base ET les clés
sudo tar czf ~/apkbuild-$(date +%F).tgz \
  /srv/apkbuild/data /srv/apkbuild/keystores /srv/apkbuild/.env
```

La purge des artefacts au-delà de la rétention tourne toutes les 6 heures,
espace par espace. Le répertoire `keystores/` n'est jamais purgé et n'apparaît
dans aucune route.

---

## Déclencher un build depuis une CI

```bash
curl -X POST https://build.exemple.tech/api/ci/builds \
  -H "Authorization: Bearer apkb_…" \
  -H "Content-Type: application/json" \
  -d '{"projectId":"…","ref":"main"}'
```

Le jeton se crée dans **Paramètres → Jetons API**. Il porte son espace : il ne
peut rien déclencher ailleurs. Comme pour les sessions, seul son SHA-256 est
stocké — il n'est lisible qu'à sa création.

---

## Documentation détaillée

- [`docs/demarche-signature-par-projet.md`](docs/demarche-signature-par-projet.md)
  — la démarche complète de mise en place de la signature et de réduction de
  taille, étape par étape, avec les retours arrière.
- [`docs/migration-serveur.md`](docs/migration-serveur.md) — déplacer une
  installation vers une autre machine : ce qui doit voyager, dans quel ordre,
  comment réduire l'interruption à quelques minutes, et les pièges rencontrés
  en conditions réelles.
- [`docs/compiler-des-applications-de-bureau.md`](docs/compiler-des-applications-de-bureau.md)
  — note de conception, **non implémentée** : compiler des applications Electron
  (`.exe`, `.msi`) depuis un dépôt Git, comme les APK. Ce qui est possible sous
  Linux via Wine, le passage au modèle multi-artefacts qui en est le préalable,
  et la question de périmètre à trancher avant de commencer.

La documentation d'API interactive est servie sur `/api/docs`, derrière un
formulaire de connexion : elle décrit précisément la surface d'attaque du
service, elle n'a pas à être publique.

---

## Limites connues

- **iOS impossible.** Exige macOS.
- **Liens de téléchargement publics et permanents.** Choix explicite.
- **Un seul APK par build.** Passer à `splits.abi` casserait la récupération
  d'artefact (`find … | head -1` choisirait une architecture au hasard) : cette
  ligne de `docker/build.sh` devra être revue **avant**, pas après.
- **Play Protect** avertit encore à l'installation. Une clé de release stable
  laisse la réputation se construire avec le volume, mais ne supprime rien
  immédiatement. Une page d'installation guidée règle plus de tickets que
  n'importe quel changement technique.
