# Réduire la friction à l'installation des APK

**Objet** : deux chantiers liés — une clé de signature de release par projet
(§1 à §6), puis la réduction de la taille de l'APK (§7). Le second dépend du
premier.
**Rédigé le** : 29 juillet 2026
**Portée** : builder APK sur VPS 2 (`/srv/apkbuild`), sources `apk-builder/`.
**Cadre** : distribution hors Google Play, sans compte Play Console.

---

## 1. Pourquoi on fait ça

Le déclencheur n'est pas la sécurité au sens « résistance à l'attaque », mais les
erreurs et avertissements que rencontrent les utilisateurs au moment d'installer.

Trois constats issus de la lecture du code :

**Ce qui marche déjà.** `server/src/index.js:235` sert l'APK avec le bon type MIME
(`application/vnd.android.package-archive`) via `res.download()`. Les en-têtes sont
corrects. Ce n'est pas là que ça casse.

**Ce qui marche par accident.** `docker/build.sh:15` fixe `HOME=/cache/home`, et
`server/src/worker.js:71` monte `/cache` depuis l'hôte. Le `debug.keystore` généré
automatiquement par Gradle survit donc d'un build à l'autre, ce qui rend les mises à
jour possibles. Personne n'a décidé ça — c'est un effet de bord du cache Gradle.

**Le risque que ça crée.** Ce fichier n'est pas sauvegardé et rien ne le distingue
d'un fichier de cache. Le jour où quelqu'un vide `/srv/apkbuild/cache` pour libérer
de l'espace, Gradle en régénère un autre. À partir de là, toute installation
par-dessus une version antérieure échoue avec *« conflit avec un package
existant »*, et le seul remède côté utilisateur est de désinstaller — donc de perdre
ses données locales.

À cela s'ajoute que la clé de debug d'Android est publique (alias
`androiddebugkey`, mot de passe `android`), partagée par le monde entier. Elle ne
peut structurellement accumuler aucune réputation auprès de Play Protect.

---

## 2. Décisions prises, et pourquoi

| Décision | Alternative écartée | Raison |
|---|---|---|
| Une clé **par projet** | Une clé unique pour tout le builder | Projets livrés à des clients distincts : chacun doit garder une identité de publication séparée |
| Clé générée **localement** avec `keytool` | Keystore géré par Expo (`eas credentials`) | Android n'a pas d'autorité de certification pour les applications. Une clé Expo et une clé maison ont exactement la même valeur — Expo n'ajouterait qu'une dépendance externe |
| Signature **après le build**, avec `apksigner` | `signingConfig` dans le `build.gradle` de chaque dépôt | `expo prebuild` régénère `android/` à chaque build, ce qui effacerait toute modification du `build.gradle`. Signer l'artefact produit est indépendant du projet et survit au prebuild |
| Keystores dans `/srv/apkbuild/keystores/` | Sous `cache/` ou `artifacts/` | `cache/` est purgeable ; `artifacts/` est **servi publiquement** par `/dl` — y déposer une clé privée la rendrait téléchargeable |
| Mots de passe en base, chiffrés `secrets.encrypt()` | En clair dans `projects.json` | Réutilise exactement le mécanisme déjà en place pour les tokens Git (`providers.token_enc`) |
| Injection par `--env-file` | `docker run -e` | Les arguments de `docker run` sont visibles dans `ps` par tout utilisateur de la machine. Convention déjà documentée dans `worker.js:44-48` |

---

## 3. Avant de toucher à quoi que ce soit

### 3.1 Sauvegarder la clé de debug actuelle

C'est le geste le plus urgent du document, indépendamment du reste. Tant qu'elle
existe, les applications déjà installées chez les utilisateurs peuvent être mises à
jour.

```bash
ssh fg   # non : c'est le VPS 2, donc
ssh vps-builder
sudo -u <user-service> cp /srv/apkbuild/cache/home/.android/debug.keystore \
     /srv/apkbuild/keystores-backup-debug.keystore
```

Puis rapatrier une copie hors serveur (`scp`), et la ranger là où vivent les autres
secrets de l'équipe.

### 3.2 Vérifier sa date d'expiration

Une clé de debug expirée fait échouer l'installation des nouveaux builds. Les
versions d'AGP n'appliquent pas toutes la même durée de validité, donc il faut
regarder :

```bash
keytool -list -v \
  -keystore /srv/apkbuild/cache/home/.android/debug.keystore \
  -storepass android | grep -i -E "valid|alias"
```

Si l'échéance est proche, la migration devient urgente au lieu d'être souhaitable.

### 3.3 Accepter le coût de migration, projet par projet

**Point non négociable, à faire valider par chaque client concerné.** Changer la clé
de signature d'une application déjà distribuée signifie que les utilisateurs
existants devront **désinstaller puis réinstaller** une fois. Android refuse
catégoriquement une mise à jour signée par une clé différente ; aucun contournement
n'existe.

Conséquences pratiques :

- Planifier le basculement sur une version qui justifie l'opération, pas sur un
  correctif mineur.
- Prévenir les utilisateurs avant, avec la marche à suivre.
- Vérifier ce qui est stocké en local dans l'app (session, brouillons, cache hors
  ligne) et ce qui sera perdu.

Un projet encore en préproduction, sans utilisateurs réels, se migre sans
précaution : commencer par celui-là.

---

## 4. La démarche

Sept étapes, dans l'ordre. Chacune se vérifie avant de passer à la suivante.

### Étape 1 — Créer l'emplacement des clés

```bash
install -d -m 0700 -o <user-service> -g <user-service> /srv/apkbuild/keystores
```

Mode `0700` : seul le compte qui fait tourner l'API y accède. Ce répertoire ne doit
apparaître ni dans une route de téléchargement, ni dans le cron de purge.

Déclarer le chemin dans `server/src/config.js`, à côté des autres :

```js
keystores: path.join(ROOT, 'keystores'),
```

**Vérification** : `ls -ld /srv/apkbuild/keystores` renvoie bien `drwx------`.

### Étape 2 — Générer une clé pour un projet

```bash
keytool -genkeypair -v \
  -keystore /srv/apkbuild/keystores/<project_id>.jks \
  -storetype PKCS12 \
  -alias <alias-projet> \
  -keyalg RSA -keysize 4096 \
  -validity 10950 \
  -dname "CN=<Nom application>, O=<Client>, L=Abidjan, C=CI"
```

Trois précisions qui évitent des erreurs :

- **PKCS12 et non JKS** : JKS est un format hérité et `keytool` émet un
  avertissement de migration à chaque usage.
- **PKCS12 ne gère pas deux mots de passe distincts** pour le magasin et la clé.
  Utiliser le même valeur pour les deux, sinon `keytool` refuse ou avertit.
- **`-validity 10950`** ≈ 30 ans. Une clé qui expire condamne l'application à
  changer d'identité : viser large.

Générer le mot de passe avec `openssl rand -base64 32`, jamais à la main.

**Vérification** : `keytool -list -v -keystore <fichier> -storetype PKCS12` affiche
l'alias et l'empreinte SHA-256. Noter cette empreinte, elle sert à l'étape 7.

### Étape 3 — Étendre le schéma de la base

Dans `server/src/db.js`, la table `projects` (ligne 53) reçoit trois colonnes. Le
fichier ne contient pour l'instant une boucle de migration additive que pour
`builds` (lignes 69-75) : en ajouter une seconde, sur le même modèle, pour
`projects`.

| Colonne | Rôle |
|---|---|
| `keystore_pass_enc` | Mot de passe chiffré par `secrets.encrypt()` |
| `keystore_alias` | Alias de la clé dans le magasin |
| `keystore_fingerprint` | Empreinte SHA-256, affichée dans l'interface |

Le mot de passe ne ressort **jamais** vers l'interface. Suivre le principe déjà posé
dans `crypto.js:47-56` : l'utilisateur reconnaît sa clé à son empreinte, il ne la
relit pas.

**Vérification** : redémarrer le service, puis `.schema projects` dans
`sqlite3 /srv/apkbuild/data/apkbuild.db`.

### Étape 4 — Résoudre la clé au moment du build

Dans `server/src/worker.js`, ajouter un `resolveKeystore(build)` à côté du
`resolveToken(build)` existant (ligne 19), construit sur le même modèle.

La table `builds` ne porte pas de `project_id` : la résolution passe par
`build.repo_name`, qui est `UNIQUE` dans `projects`. Conséquence assumée — la clé
utilisée est celle **en vigueur au démarrage du build**, pas celle enregistrée au
moment de la mise en file. C'est le comportement souhaitable : si on remplace une
clé, les builds en attente doivent prendre la nouvelle.

Puis, dans `runBuild()` :

```js
// Le fichier est monté en lecture seule ; le mot de passe passe par
// l'env-file en 0600, comme le token Git — jamais en argument de docker run.
if (ks) {
  envLines.push(`KEYSTORE_FILE=/keystore/app.jks`);
  envLines.push(`KEYSTORE_ALIAS=${ks.alias}`);
  envLines.push(`KEYSTORE_PASSWORD=${ks.password}`);
  args.push('-v', `${ks.path}:/keystore/app.jks:ro`);
}
```

Le conteneur tourne sous l'UID du service (`worker.js:69`), donc le fichier en
`0600` appartenant à ce compte est lisible. Le `.build-env` est détruit avec
l'espace de travail en fin de build (`worker.js:124`) : le mot de passe ne persiste
pas.

**Vérification** : lancer un build et confirmer dans le log que `KEYSTORE_FILE` est
présent — sans que le mot de passe apparaisse.

### Étape 5 — Aligner et signer dans le conteneur

Dans `docker/build.sh`, entre la compilation Gradle (ligne 84) et la récupération de
l'artefact (ligne 95).

Attention à un piège : le gabarit React Native déclare par défaut un
`signingConfig` de release qui **pointe vers la clé de debug**. Un `assembleRelease`
ne produit donc pas un APK non signé, mais un APK signé avec la mauvaise clé. Il
faut retirer la signature existante avant d'apposer la nôtre.

```bash
section "Signature"
if [ -n "${KEYSTORE_FILE:-}" ]; then
  # 1. Retirer la signature héritée du gabarit (v1/JAR)
  zip -d "$APK_SRC" 'META-INF/*.RSA' 'META-INF/*.SF' 'META-INF/*.DSA' || true

  # 2. Aligner AVANT de signer : apksigner préserve l'alignement,
  #    l'inverse n'est pas vrai.
  zipalign -p -f 4 "$APK_SRC" /workspace/aligned.apk

  # 3. Signer en v2+v3. v3 autorise une rotation de clé ultérieure.
  apksigner sign \
    --ks "$KEYSTORE_FILE" --ks-key-alias "$KEYSTORE_ALIAS" \
    --ks-pass env:KEYSTORE_PASSWORD --key-pass env:KEYSTORE_PASSWORD \
    --v2-signing-enabled true --v3-signing-enabled true \
    --out /workspace/signed.apk /workspace/aligned.apk

  apksigner verify --print-certs /workspace/signed.apk
  APK_SRC=/workspace/signed.apk
fi
```

`zipalign` et `apksigner` viennent des build-tools du SDK Android, déjà présents
dans l'image `rn-android-builder:1` — rien à installer.

Le `--ks-pass env:` lit la variable d'environnement au lieu de prendre le mot de
passe en argument : cohérent avec le reste, et invisible dans la table des
processus du conteneur.

**Vérification** : `apksigner verify --print-certs` doit afficher l'empreinte notée
à l'étape 2. Si elle diffère, la signature héritée n'a pas été retirée
correctement — c'est le point à valider en premier au build initial.

### Étape 6 — Exposer la gestion dans l'interface

`server/src/views.js` gère déjà les écrans Projets et Connexions. Ajouter au
formulaire projet : dépôt du fichier `.jks`, saisie de l'alias et du mot de passe,
affichage de l'empreinte.

Deux garde-fous à ne pas oublier :

- Le formulaire doit porter le jeton anti-CSRF, comme les autres
  (`config.js:86-94`).
- Valider le fichier avant de l'accepter : un `keytool -list` qui échoue signifie
  mot de passe faux ou fichier corrompu. Le dire à ce moment-là, pas au premier
  build raté.

### Étape 7 — Basculer un projet, un seul

Ne pas migrer tout le parc d'un coup.

1. Choisir un projet **sans utilisateurs en production**.
2. Enregistrer sa clé, lancer un build, vérifier l'empreinte.
3. Installer l'APK sur un téléphone neuf.
4. Reconstruire, réinstaller **par-dessus** : la mise à jour doit passer sans
   avertissement de conflit. C'est le test qui valide toute la chaîne.
5. Seulement ensuite, migrer les projets suivants, en respectant §3.3.

---

## 5. Retour arrière

À chaque étape, le retour est simple parce que rien n'est destructif :

| Étape | Annulation |
|---|---|
| 1 à 3 | Additif seulement. Le `if` de l'étape 5 ne se déclenche pas sans `KEYSTORE_FILE` : les builds continuent comme avant |
| 4 à 6 | Vider les colonnes keystore du projet → retour à la signature debug |
| 7 | La clé de debug sauvegardée en §3.1 permet de reproduire un APK compatible avec les installations existantes |

**Le seul point irréversible est côté utilisateur** : une fois qu'il a installé un
APK signé avec la nouvelle clé, revenir à l'ancienne lui imposera une nouvelle
désinstallation.

---

## 6. Contrôle final

- [ ] `debug.keystore` sauvegardé hors serveur, date d'expiration connue
- [ ] `/srv/apkbuild/keystores` en `0700`, absent des routes de téléchargement
- [ ] Aucune clé, aucun mot de passe dans `git status`
- [ ] `apksigner verify --print-certs` renvoie l'empreinte attendue
- [ ] Mise à jour par-dessus une installation antérieure : sans erreur
- [ ] Le log de build ne contient nulle part le mot de passe
- [ ] Empreinte de chaque projet consignée hors du serveur

Puis, pour le chantier taille :

- [ ] Taille de référence relevée avant modification
- [ ] Version de RN ≥ 0.71 confirmée sur les projets concernés
- [ ] `unzip -l` confirme la présence d'une seule architecture dans `lib/`
- [ ] APK installé **et lancé** sur un vrai téléphone : un APK plus petit qui
      plante au démarrage est une régression, pas un gain

---

## 7. Réduire la taille de l'APK

### 7.1 Il n'y a pas de bouton « compression élevée »

Autant l'écrire tout de suite pour ne pas le chercher : le plugin Android de Gradle
**n'expose aucun réglage de niveau de compression**. Un APK est une archive ZIP en
DEFLATE, et le niveau est fixé par la chaîne d'outils.

Pire, sur la partie qui pèse le plus lourd — les bibliothèques natives `.so` — la
tendance officielle va dans le sens **inverse**. Depuis AGP 8, elles sont
délibérément stockées **non compressées** et alignées en mémoire, pour qu'Android
les charge directement depuis l'archive au lieu d'en extraire une copie sur le
disque. L'APK est plus gros, mais l'**empreinte réelle après installation** est plus
petite.

Or c'est cette empreinte qui provoque nos échecs : l'installateur Android réclame
deux à trois fois la taille du contenu en espace libre temporaire. Compresser
davantage les `.so` déplacerait le problème au lieu de le régler.

**Conclusion** : les gains viennent de ce qu'on **retire** du paquet, pas de la
façon dont on le comprime.

### 7.2 Les leviers, par ordre de rendement

| # | Levier | Mécanisme | Où ça se règle |
|---|---|---|---|
| 1 | `assembleRelease` | Retire les symboles de débogage des `.so` et le runtime de debug — un build debug les embarque tous | Builder (`projects.gradle_task`) |
| 2 | Une seule architecture | Un APK universel contient `arm64-v8a`, `armeabi-v7a`, `x86` et `x86_64` : quatre copies de chaque `.so` (Hermes, Reanimated, etc.) | Builder (`build.sh`) |
| 3 | R8 + `shrinkResources` | Supprime le code et les ressources non atteints | Projet, au cas par cas |
| 4 | `resConfigs "fr","en"` | Écarte les traductions inutilisées d'AndroidX | Projet |
| 5 | Images en WebP | Souvent le plus gros gain réel d'une app RN, et le plus ignoré | Projet |

Les deux premiers sont à notre main et n'exigent aucune modification des dépôts.
Les trois suivants appartiennent aux équipes applicatives — les leur signaler, ne
pas les leur imposer depuis le builder.

**Le point 1 dépend du chantier signature.** Passer `gradle_task` à
`assembleRelease` sans clé produit un APK qu'Android refuse
(`INSTALL_PARSE_FAILED_NO_CERTIFICATES`). C'est l'étape 5 de ce document qui rend
ce basculement possible : faire la signature d'abord, la taille ensuite.

### 7.3 Restreindre l'architecture depuis le builder

React Native 0.71 et suivants lisent une propriété Gradle
`reactNativeArchitectures`, présente dans le `gradle.properties` généré aussi bien
par le gabarit bare que par `expo prebuild`. Elle s'écrase en ligne de commande,
donc **sans toucher au dépôt et sans être effacée par le prebuild** — contrairement
à une configuration `splits.abi` inscrite dans le `build.gradle`.

Dans `docker/build.sh`, à la compilation Gradle (ligne 91) :

```bash
ABIS="${ABIS:-arm64-v8a}"
./gradlew "$GRADLE_TASK" \
  -PreactNativeArchitectures="$ABIS" \
  --no-daemon --console=plain --stacktrace \
  -Dorg.gradle.jvmargs="-Xmx4g -XX:MaxMetaspaceSize=1g"
```

Et rendre `ABIS` réglable par projet, exactement comme `gradle_task` :
colonne dans `projects`, ligne dans le `.build-env` de `worker.js`.

**Pourquoi `arm64-v8a` par défaut et pas les quatre.** C'est l'architecture de
l'essentiel du parc en service. Deux réserves à connaître avant de généraliser :

- Les téléphones 32 bits uniquement (grosso modo d'avant 2015) ne l'installeront
  pas. Si le parc client en compte, ajouter `armeabi-v7a`.
- Les **émulateurs** tournent souvent en `x86_64`. Une équipe QA sur émulateur aura
  besoin de son propre réglage — c'est précisément pour ça que le paramètre est par
  projet.

Cette approche produit **un seul APK** contenant une seule architecture. C'est
volontairement différent d'un `splits.abi`, qui en produirait plusieurs et
casserait la récupération d'artefact : `build.sh:96` prend le premier fichier trouvé
par `find … | sort | head -1` et en choisirait un au hasard. Si un jour vous passez
aux splits, cette ligne devra être revue **avant**.

**Vérification préalable** : confirmer la version de React Native des projets
concernés. Sur une version antérieure à 0.71, la propriété est ignorée
silencieusement — le build réussira sans rien réduire. Le comparatif de taille de
l'étape suivante le révélera.

### 7.4 Mesurer, sinon on croit avoir gagné

`meta.json` enregistre déjà `apk_size` (`build.sh:101`), donc la base contient
l'historique des tailles : la comparaison avant/après est directement lisible dans
l'interface, sans outillage supplémentaire.

Pour savoir *ce qui* pèse, sur un APK récupéré :

```bash
# Les vingt entrées les plus lourdes
unzip -l app.apk | sort -k1 -n -r | head -20

# Total des bibliothèques natives, par architecture
unzip -l app.apk | grep '/lib/' | awk '{s[$4]+=$1} END {for (a in s) print s[a], a}'
```

Si `apkanalyzer` est présent dans l'image (il accompagne les cmdline-tools du SDK),
`apkanalyzer apk file-size` et `apkanalyzer files list` donnent la même chose en
plus lisible.

Faire cette mesure **avant** toute modification, sinon il n'y a pas de point de
comparaison.

### 7.5 Ce qu'il ne faut pas faire

- **Recompresser l'APK après signature** avec `7z`, `zopfli` ou équivalent. Cela
  invalide la signature. Toute manipulation de l'archive se place avant
  `apksigner`, jamais après.
- **Forcer R8 depuis le builder** via un script d'init Gradle. Techniquement
  faisable, mais R8 casse le code reposant sur la réflexion, et de nombreuses
  bibliothèques RN en dépendent. Le résultat serait un APK plus petit qui plante à
  l'exécution — un échec bien plus coûteux à diagnostiquer que quelques mégaoctets
  de trop. À laisser en opt-in projet par projet, chacun avec ses règles ProGuard.
- **Recompresser les `.so`** pour gagner sur la taille affichée : voir §7.1, ça
  dégrade l'empreinte d'installation, donc l'objectif poursuivi.

---

## 8. Ce qui reste ouvert

**À vérifier sur la machine** — je ne l'ai pas fait, ne pas supposer :

- Expiration réelle du `debug.keystore` actuel (§3.2).
- `minSdkVersion` de chaque projet. Un seuil trop haut donne *« application non
  compatible »* sur les téléphones anciens, ce qui ressemble à une panne du builder
  alors que c'est une configuration de projet.
- Comportement exact du `zip -d` puis `apksigner` sur un APK issu du gabarit RN.
  L'enchaînement est celui recommandé, mais il se valide au premier build, pas sur
  le papier.

- Version de React Native de chaque projet, pour la propriété
  `reactNativeArchitectures` (§7.3). En dessous de 0.71, elle est ignorée sans
  erreur.
- Taille de référence de chaque APK **avant** modification (§7.4). Sans elle, aucun
  gain n'est démontrable.

**Hors de portée sans compte Google Play**, pour éviter les fausses attentes :

- L'avertissement Play Protect à l'installation. Une clé de release stable permet à
  la réputation de se construire avec le volume d'installations, mais ne supprime
  rien immédiatement.
- L'API Play Integrity, qui exigerait l'enregistrement de la clé en Play Console.
- L'autorisation « installer des applications inconnues », demandée par Android à
  chaque source. Une page d'installation guidée règle plus de tickets de support que
  n'importe quel changement technique de ce document.
